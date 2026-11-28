import { HttpException, HttpStatus, Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import { Subscription, interval } from 'rxjs';
import { SrsService } from '../srs/srs.service';
import type { SrsStreamInfo } from '../srs/srs.service';
import {
  CALLSIGNS,
  DEFAULT_FEED_LABELS,
  DEFAULT_NICKNAMES,
  ROOM_CODE_LENGTH,
  ROOM_CODE_PREFIX,
  ROOM_MAX_MEMBERS,
  type ClientMessage,
  type MemberDto,
  type RoomDto,
  type SelfDto,
  type StreamInfo,
} from '../../../../packages/shared/protocol';
import { RealtimeService, type ClientSocket } from './realtime.service';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
/** 房间内所有成员离线后的保留时长（便于用同一席位重新加入） */
const ROOM_IDLE_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_ROOMS = 500;

export interface MemberRecord {
  id: string;
  callsign: string;
  nickname: string;
  feedLabel: string;
  token: string;
  streamKey: string;
  /** 只读拉流令牌，媒体代理用它找回真实流名 */
  playToken: string;
  isCreator: boolean;
  joinedAt: number;
  /** 是否有 WebSocket 连接在房间内 */
  online: boolean;
  stream: StreamInfo;
}

export interface RoomRecord {
  code: string;
  passcode: string;
  rtmpServer: string;
  createdAt: number;
  /** 最后一位成员离线的时间，用于过期回收 */
  emptySince: number | null;
  /** SRS 流媒体服务是否可达 */
  srsOnline: boolean;
  members: MemberRecord[];
}

export interface JoinOptions {
  memberId?: string;
  nickname?: string;
  token?: string;
  rtmpServer: string;
}

function randomFrom(chars: string, length: number): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += chars[bytes[i] % chars.length];
  return out;
}

export function genRoomCode(): string {
  return ROOM_CODE_PREFIX + randomFrom(CODE_CHARS, ROOM_CODE_LENGTH);
}

export function genStreamKey(code: string): string {
  const normalized = code.replace(/[^A-Za-z0-9]/g, '').toLowerCase();
  return `fp_live_${normalized}_${randomFrom('abcdef0123456789', 6)}`;
}

/** 归一化房间码：大写、去空格，允许省略 `FP-` 前缀；不合法返回 null */
export function normalizeRoomCode(input: string): string | null {
  const raw = String(input ?? '').replace(/\s+/g, '').toUpperCase();
  if (!raw) return null;
  const code = raw.startsWith(ROOM_CODE_PREFIX) ? raw : `${ROOM_CODE_PREFIX}${raw}`;
  const body = code.slice(ROOM_CODE_PREFIX.length);
  if (body.length !== ROOM_CODE_LENGTH || !/^[A-Z0-9]+$/.test(body)) return null;
  return code;
}

const offlineStream = (): StreamInfo => ({
  online: false,
  onlineSince: null,
  bitrateKbps: null,
  videoCodec: null,
  audioCodec: null,
});

/**
 * 房间管理（内存存储）：
 * 创建 / 加入 / 离开、席位与串流密钥分配、成员在线状态、推流状态同步。
 */
@Injectable()
export class RoomsService implements OnModuleInit {
  private readonly logger = new Logger(RoomsService.name);
  private readonly rooms = new Map<string, RoomRecord>();
  private readonly byMember = new Map<string, RoomRecord>();
  private readonly byToken = new Map<string, string>();
  private readonly subs: Subscription[] = [];

  constructor(
    @Inject(SrsService) private readonly srs: SrsService,
    @Inject(RealtimeService) private readonly realtime: RealtimeService,
  ) {}

  onModuleInit() {
    this.subs.push(this.srs.changes.subscribe(() => this.syncStreams()));
    this.subs.push(this.realtime.inbound.subscribe(({ socket, msg }) => this.onMessage(socket, msg)));
    this.subs.push(this.realtime.closed.subscribe((socket) => this.onClosed(socket)));
    const gc = interval(60_000);
    this.subs.push(gc.subscribe(() => this.gc()));
  }

  onApplicationShutdown() {
    for (const s of this.subs) s.unsubscribe();
  }

  /* ---------------- 房间生命周期 ---------------- */

  create(opts: JoinOptions): { room: RoomDto; self: SelfDto } {
    this.gc();
    if (this.rooms.size >= MAX_ROOMS) {
      throw new HttpException('服务器房间数已达上限，请稍后再试', HttpStatus.SERVICE_UNAVAILABLE);
    }
    let code = genRoomCode();
    for (let i = 0; i < 20 && this.rooms.has(code); i++) code = genRoomCode();

    const room: RoomRecord = {
      code,
      passcode: code,
      rtmpServer: opts.rtmpServer,
      createdAt: Date.now(),
      emptySince: null,
      srsOnline: this.srs.current().online,
      members: [],
    };
    this.rooms.set(code, room);
    const member = this.addMember(room, { ...opts, isCreator: true });
    this.logger.log(`房间 ${code} 已由成员 ${member.callsign} 创建`);
    return { room: this.toDto(room), self: this.toSelf(room, member, opts.rtmpServer) };
  }

  join(codeInput: string, opts: JoinOptions): { room: RoomDto; self: SelfDto } {
    const code = normalizeRoomCode(codeInput);
    const room = code ? this.rooms.get(code) : undefined;
    if (!room) throw new HttpException('房间不存在或已关闭', HttpStatus.NOT_FOUND);

    const existing = opts.memberId ? room.members.find((m) => m.id === opts.memberId) : undefined;
    if (existing) {
      if (opts.token && opts.token !== existing.token) {
        throw new HttpException('成员凭证无效', HttpStatus.FORBIDDEN);
      }
      // 重新加入：找回原有席位与串流密钥
      return { room: this.toDto(room), self: this.toSelf(room, existing, opts.rtmpServer) };
    }

    if (room.members.length >= ROOM_MAX_MEMBERS) {
      throw new HttpException(`房间已满（${ROOM_MAX_MEMBERS}/${ROOM_MAX_MEMBERS}）`, HttpStatus.CONFLICT);
    }
    const member = this.addMember(room, { ...opts, isCreator: false });
    this.logger.log(`成员 ${member.callsign} 加入房间 ${room.code}`);
    const dto = this.toDto(room);
    this.realtime.broadcast(room.code, { t: 'room:update', room: dto }, undefined);
    return { room: dto, self: this.toSelf(room, member, opts.rtmpServer) };
  }

  /** 查询房间（不含密钥），用于加入前校验 */
  inspect(codeInput: string, rtmpServer: string): RoomDto {
    const code = normalizeRoomCode(codeInput);
    const room = code ? this.rooms.get(code) : undefined;
    if (!room) throw new HttpException('房间不存在或已关闭', HttpStatus.NOT_FOUND);
    const dto = this.toDto(room);
    dto.rtmpServer = rtmpServer;
    return dto;
  }

  findByCode(code: string): RoomRecord | undefined {
    return this.rooms.get(code);
  }

  findByMember(memberId: string): { room: RoomRecord; member: MemberRecord } | undefined {
    const room = this.byMember.get(memberId);
    const member = room?.members.find((m) => m.id === memberId);
    return room && member ? { room, member } : undefined;
  }

  leave(memberId: string): void {
    const found = this.findByMember(memberId);
    if (!found) return;
    this.removeMember(found.room, found.member);
  }

  /* ---------------- WebSocket 会话 ---------------- */

  /** 成员通过 WebSocket 进入房间 */
  attach(socket: ClientSocket, codeInput: string, memberId: string, token: string) {
    const code = normalizeRoomCode(codeInput);
    const found = code && memberId ? this.findByMember(memberId) : undefined;
    if (!code || !found || found.room.code !== code) {
      this.realtime.send(socket, { t: 'error', message: '房间不存在或已关闭' });
      return;
    }
    if (token !== found.member.token) {
      this.realtime.send(socket, { t: 'error', message: '成员凭证无效，请重新加入房间' });
      return;
    }
    socket.data.memberId = memberId;
    socket.data.code = code;
    found.member.online = true;
    found.room.emptySince = null;

    this.realtime.send(socket, {
      t: 'room:joined',
      self: this.toSelf(found.room, found.member, found.room.rtmpServer),
      room: this.toDto(found.room),
    });
    this.realtime.broadcast(code, { t: 'room:update', room: this.toDto(found.room) }, socket);
  }

  private onClosed(socket: ClientSocket) {
    const { memberId, code } = socket.data ?? {};
    if (!memberId || !code) return;
    socket.data.memberId = undefined;
    socket.data.code = undefined;
    const found = this.findByMember(memberId);
    if (!found || found.room.code !== code) return;
    const stillOnline = this.realtime
      .socketsInRoom(code)
      .some((s) => s !== socket && s.data?.memberId === memberId);
    if (stillOnline) return;
    found.member.online = false;
    if (found.room.members.every((m) => !m.online)) found.room.emptySince = Date.now();
    this.realtime.broadcast(code, { t: 'room:update', room: this.toDto(found.room) });
  }

  private onMessage(socket: ClientSocket, msg: ClientMessage) {
    try {
      void this.handleMessage(socket, msg);
    } catch (err) {
      this.realtime.send(socket, { t: 'error', message: String((err as Error).message || err) });
    }
  }

  private async handleMessage(socket: ClientSocket, msg: ClientMessage) {
    switch (msg.t) {
      case 'ping':
        this.realtime.send(socket, { t: 'pong', ts: Number(msg.ts) || 0 });
        return;
      case 'room:join':
        this.attach(socket, String(msg.code ?? ''), String(msg.memberId ?? ''), String(msg.token ?? ''));
        return;
      case 'room:leave': {
        const { memberId, code } = socket.data ?? {};
        socket.data.memberId = undefined;
        socket.data.code = undefined;
        this.realtime.send(socket, { t: 'room:left' });
        if (memberId) this.leave(memberId);
        return;
      }
      case 'marker': {
        const { memberId, code } = socket.data ?? {};
        if (!memberId || !code) return;
        const x = Number(msg.x);
        const y = Number(msg.y);
        if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) return;
        const target = String(msg.target ?? memberId);
        this.realtime.broadcast(
          code,
          {
            t: 'marker',
            from: memberId,
            x,
            y,
            target,
            label: typeof msg.label === 'string' ? msg.label.slice(0, 20) : undefined,
          },
          socket,
        );
        return;
      }
      case 'stream:stop': {
        const { memberId } = socket.data ?? {};
        if (!memberId) return;
        const found = this.findByMember(memberId);
        if (!found) return;
        const info = this.srs.find(found.member.streamKey);
        try {
          if (info?.clientId != null) {
            await this.srs.kickClient(info.clientId);
            this.logger.log(`已断开成员 ${found.member.callsign} 的推流`);
          }
        } catch (err) {
          this.realtime.send(socket, { t: 'error', message: String((err as Error).message || err) });
        }
        return;
      }
      default:
        return;
    }
  }

  /* ---------------- 推流状态同步 ---------------- */

  /** 根据 SRS 快照刷新所有成员的推流状态，有变化则广播 */
  private syncStreams() {
    const snap = this.srs.current();
    for (const room of this.rooms.values()) {
      let changed = room.srsOnline !== snap.online;
      room.srsOnline = snap.online;
      for (const m of room.members) {
        const info = snap.streams.get(`live/${m.streamKey}`);
        const next = this.toStreamInfo(m, info);
        if (!sameStream(m.stream, next)) {
          m.stream = next;
          changed = true;
        }
      }
      if (changed) this.realtime.broadcast(room.code, { t: 'room:update', room: this.toDto(room) });
    }
  }

  private toStreamInfo(member: MemberRecord, info: SrsStreamInfo | undefined): StreamInfo {
    if (!info || !info.publishing) {
      return { online: false, onlineSince: null, bitrateKbps: null, videoCodec: null, audioCodec: null };
    }
    return {
      online: true,
      onlineSince: member.stream.online ? member.stream.onlineSince : Date.now(),
      bitrateKbps: info.bitrateKbps,
      videoCodec: info.videoCodec,
      audioCodec: info.audioCodec,
    };
  }

  /* ---------------- 内部工具 ---------------- */

  private addMember(room: RoomRecord, opts: JoinOptions & { isCreator: boolean }): MemberRecord {
    // 同一成员 id 只能在一个房间内
    if (opts.memberId) {
      const prev = this.byMember.get(opts.memberId);
      if (prev) {
        const old = prev.members.find((m) => m.id === opts.memberId);
        if (old) this.removeMember(prev, old);
      }
    }

    const used = new Set(room.members.map((m) => m.callsign));
    const slot = CALLSIGNS.findIndex((c) => !used.has(c));
    if (slot < 0) throw new HttpException('没有可用席位', HttpStatus.CONFLICT);
    const callsign = CALLSIGNS[slot];

    const member: MemberRecord = {
      id: opts.memberId && opts.memberId.length >= 8 ? opts.memberId : randomUUID(),
      callsign,
      nickname: sanitizeNickname(opts.nickname) || DEFAULT_NICKNAMES[slot],
      feedLabel: DEFAULT_FEED_LABELS[slot],
      token: randomBytes(24).toString('hex'),
      streamKey: genStreamKey(room.code),
      playToken: randomBytes(12).toString('hex'),
      isCreator: opts.isCreator,
      joinedAt: Date.now(),
      online: false,
      stream: offlineStream(),
    };
    room.members.push(member);
    this.byMember.set(member.id, room);
    this.byToken.set(member.playToken, member.streamKey);
    return member;
  }

  private removeMember(room: RoomRecord, member: MemberRecord) {
    room.members = room.members.filter((m) => m.id !== member.id);
    this.byMember.delete(member.id);
    this.byToken.delete(member.playToken);
    if (room.members.length === 0) {
      this.rooms.delete(room.code);
      this.logger.log(`房间 ${room.code} 已解散`);
      return;
    }
    if (!room.members.some((m) => m.isCreator) && room.members[0]) room.members[0].isCreator = true;
    if (room.members.every((m) => !m.online)) room.emptySince = Date.now();
    this.realtime.broadcast(room.code, { t: 'room:update', room: this.toDto(room) });
  }

  private gc() {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      const idle = room.emptySince != null && now - room.emptySince > ROOM_IDLE_TTL_MS;
      const stale = now - room.createdAt > 12 * 60 * 60 * 1000;
      if (idle || stale) {
        for (const m of room.members) {
          this.byMember.delete(m.id);
          this.byToken.delete(m.playToken);
        }
        this.rooms.delete(code);
      }
    }
  }

  /** 拉流令牌 → 真实流名（供媒体代理使用），找不到返回 null */
  resolveStreamName(playToken: string): string | null {
    return this.byToken.get(playToken) ?? null;
  }

  private toDto(room: RoomRecord): RoomDto {
    return {
      code: room.code,
      passcode: room.passcode,
      rtmpServer: room.rtmpServer,
      maxMembers: ROOM_MAX_MEMBERS,
      createdAt: room.createdAt,
      srsOnline: room.srsOnline,
      members: room.members.map((m): MemberDto => ({
        id: m.id,
        callsign: m.callsign as MemberDto['callsign'],
        nickname: m.nickname,
        feedLabel: m.feedLabel,
        online: m.online,
        isCreator: m.isCreator,
        joinedAt: m.joinedAt,
        playToken: m.playToken,
        stream: { ...m.stream },
      })),
    };
  }

  private toSelf(room: RoomRecord, member: MemberRecord, rtmpServer: string): SelfDto {
    return {
      id: member.id,
      callsign: member.callsign as SelfDto['callsign'],
      nickname: member.nickname,
      feedLabel: member.feedLabel,
      token: member.token,
      streamKey: member.streamKey,
      rtmpServer,
    };
  }
}

function sanitizeNickname(nick?: string): string {
  return (nick ?? '').replace(/[<>]/g, '').trim().slice(0, 12);
}

function sameStream(a: StreamInfo, b: StreamInfo): boolean {
  return (
    a.online === b.online &&
    a.onlineSince === b.onlineSince &&
    a.videoCodec === b.videoCodec &&
    a.audioCodec === b.audioCodec &&
    Math.round((a.bitrateKbps ?? 0) / 50) === Math.round((b.bitrateKbps ?? 0) / 50)
  );
}

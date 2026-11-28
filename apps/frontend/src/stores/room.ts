import { computed, reactive } from 'vue';
import type { MemberDto, RoomDto, RoomJoinResponse, SelfDto } from '../../../../packages/shared/protocol';
import { MARKER_TTL, ROOM_MAX_MEMBERS } from '../../../../packages/shared/protocol';
import { api } from '@/api/http';
import { RoomSocket } from '@/api/socket';
import { resetRoomView, showToast } from '@/stores/ui';

/** 战术标点（归一化坐标 0~1，相对目标成员的画面） */
export interface Marker {
  id: number;
  /** 标点所在画面的成员 */
  memberId: string;
  /** 标记人 */
  from: string;
  x: number;
  y: number;
  at: number;
  label?: string;
}

/** 持久化的会话，用于刷新 / 重启后自动回到房间 */
interface SavedSession {
  code: string;
  memberId: string;
  token: string;
}

const STORAGE_SESSION = 'fighting-plus.session.v1';
const STORAGE_MEMBER = 'fighting-plus.member.v1';

interface RoomState {
  phase: 'lobby' | 'in-room';
  room: RoomDto | null;
  self: SelfDto | null;
  connected: boolean;
  rtt: number | null;
  /** 服务端是否可达（大厅显示） */
  serverOk: boolean | null;
  srsOnline: boolean;
  markers: Marker[];
}

export const roomState = reactive<RoomState>({
  phase: 'lobby',
  room: null,
  self: null,
  connected: false,
  rtt: null,
  serverOk: null,
  srsOnline: false,
  markers: [],
});

let socket: RoomSocket | null = null;
let markerSeq = 0;
let healthTimer: number | undefined;

/** 本机稳定成员 id（用于找回席位与串流密钥） */
export function getMemberId(): string {
  let id = '';
  try {
    id = localStorage.getItem(STORAGE_MEMBER) || '';
    if (!id) {
      const bytes = new Uint8Array(8);
      crypto.getRandomValues(bytes);
      id = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
      localStorage.setItem(STORAGE_MEMBER, id);
    }
  } catch {
    id = id || `m-${Date.now().toString(36)}`;
  }
  return id;
}

function saveSession(): void {
  if (!roomState.room || !roomState.self) return;
  const s: SavedSession = { code: roomState.room.code, memberId: roomState.self.id, token: roomState.self.token };
  try {
    localStorage.setItem(STORAGE_SESSION, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

function readSession(): SavedSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_SESSION);
    if (!raw) return null;
    const s = JSON.parse(raw) as SavedSession;
    return s && s.code && s.memberId && s.token ? s : null;
  } catch {
    return null;
  }
}

function clearSession(): void {
  try {
    localStorage.removeItem(STORAGE_SESSION);
  } catch {
    /* ignore */
  }
}

export function useRoom() {
  const peers = computed<MemberDto[]>(() => {
    const me = roomState.self?.id;
    return (roomState.room?.members ?? []).filter((m) => m.id !== me);
  });

  const selfMember = computed<MemberDto | null>(() => {
    const me = roomState.self?.id;
    return (roomState.room?.members ?? []).find((m) => m.id === me) ?? null;
  });

  /** 本人推流状态 */
  const selfLive = computed(() => Boolean(selfMember.value?.stream.online));

  const onlineCount = computed(() => (roomState.room?.members ?? []).filter((m) => m.online).length);
  const memberCount = computed(() => roomState.room?.members.length ?? 0);

  /** 进入房间（REST 已返回席位），建立实时通道 */
  function enterRoom(res: RoomJoinResponse): void {
    roomState.room = res.room;
    roomState.self = res.self;
    roomState.srsOnline = res.room.srsOnline;
    roomState.phase = 'in-room';
    roomState.markers = [];
    saveSession();
    connect();
  }

  function connect(): void {
    socket?.close();
    socket = new RoomSocket({
      onOpen: () => {
        roomState.connected = true;
        const s = roomState.self;
        const r = roomState.room;
        if (!s || !r) return;
        socket?.send({ t: 'room:join', code: r.code, memberId: s.id, token: s.token });
      },
      onClose: () => {
        roomState.connected = false;
      },
      onRtt: (rtt) => {
        roomState.rtt = rtt;
      },
      onMessage: (msg) => {
        switch (msg.t) {
          case 'room:joined':
            roomState.room = msg.room;
            roomState.self = msg.self;
            break;
          case 'room:update':
            roomState.room = msg.room;
            roomState.srsOnline = msg.room.srsOnline;
            break;
          case 'marker':
            pushMarker({ id: ++markerSeq, memberId: msg.target, from: msg.from, x: msg.x, y: msg.y, at: Date.now(), label: msg.label });
            break;
          case 'pong':
            roomState.rtt = Math.max(0, Date.now() - msg.ts);
            break;
          case 'error':
            onError(msg.message);
            break;
          default:
            break;
        }
      },
    });
    socket.connect();
  }

  /** WS 层的错误统一通过 toast 提示 */
  function onError(message: string): void {
    if (/房间不存在|凭证无效/.test(message)) {
      exitToLocalLobby();
    }
    showToast(message, 'error');
  }

  /** 创建房间（尚未进入） */
  async function createRoom(): Promise<RoomJoinResponse> {
    return api.createRoom({ memberId: getMemberId() });
  }

  /** 加入房间并进入 */
  async function joinRoom(codeInput: string): Promise<RoomJoinResponse> {
    const code = codeInput.trim().toUpperCase();
    const saved = readSession();
    const token = saved && saved.code === code ? saved.token : undefined;
    const res = await api.joinRoom(code, { memberId: getMemberId(), token });
    enterRoom(res);
    return res;
  }

  /** 离开创建页时放弃房间 */
  async function abandonCreated(res: RoomJoinResponse): Promise<void> {
    try {
      await api.leaveRoom(res.room.code, res.self.id);
    } catch {
      /* ignore */
    }
  }

  /** 刷新 / 重启后恢复会话 */
  async function restoreSession(): Promise<boolean> {
    const saved = readSession();
    if (!saved) return false;
    try {
      const res = await api.joinRoom(saved.code, { memberId: saved.memberId, token: saved.token });
      enterRoom(res);
      return true;
    } catch {
      clearSession();
      return false;
    }
  }

  /** 退出到本地大厅（服务端会话失效时调用） */
  function exitToLocalLobby(): void {
    socket?.close();
    socket = null;
    roomState.phase = 'lobby';
    roomState.room = null;
    roomState.self = null;
    roomState.connected = false;
    roomState.rtt = null;
    roomState.markers = [];
    clearSession();
    resetRoomView();
  }

  async function leave(): Promise<void> {
    const code = roomState.room?.code;
    const memberId = roomState.self?.id;
    socket?.send({ t: 'room:leave' });
    exitToLocalLobby();
    if (code && memberId) {
      try {
        await api.leaveRoom(code, memberId);
      } catch {
        /* ignore */
      }
    }
  }

  /** 在队友画面上投放战术标点 */
  function sendMarker(memberId: string, x: number, y: number): void {
    socket?.send({ t: 'marker', x, y, target: memberId });
  }

  /** 请求服务端断开本人的推流（OBS 会显示断开） */
  function stopStream(): void {
    socket?.send({ t: 'stream:stop' });
  }

  /** 大厅内轮询服务端可达性 */
  function startHealthPoll(): void {
    stopHealthPoll();
    const tick = async () => {
      try {
        const h = await api.health();
        roomState.serverOk = true;
        roomState.srsOnline = h.srsOnline;
      } catch {
        roomState.serverOk = false;
      }
    };
    void tick();
    healthTimer = window.setInterval(() => void tick(), 10_000);
  }

  function stopHealthPoll(): void {
    if (healthTimer) window.clearInterval(healthTimer);
    healthTimer = undefined;
  }

  return {
    state: roomState,
    peers,
    selfMember,
    selfLive,
    onlineCount,
    memberCount,
    maxMembers: ROOM_MAX_MEMBERS,
    enterRoom,
    createRoom,
    joinRoom,
    abandonCreated,
    restoreSession,
    leave,
    sendMarker,
    stopStream,
    startHealthPoll,
    stopHealthPoll,
  };
}

function pushMarker(m: Marker): void {
  roomState.markers.push(m);
  window.setTimeout(() => {
    roomState.markers = roomState.markers.filter((x) => x.id !== m.id);
  }, MARKER_TTL + 300);
}

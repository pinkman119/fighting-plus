/* 屏幕共享原型 - WebRTC Mesh 渲染逻辑（远端主区域 + 本机底部预览） */

let socket = null
let socketUrl = ''

let myId = null
let roomId = null
let myName = ''
let localStream = null

/** peerId -> { pc, name, polite, makingOffer, ignoreOffer, pendingCandidates[] } */
const peers = new Map()
/** peerId -> MediaStream */
const remoteStreams = new Map()

const $ = (id) => document.getElementById(id)

// ---------- Socket 连接（地址可配置，支持跨机器） ----------

function normalizeServerUrl(raw) {
  const v = (raw || '').trim() || 'localhost:3100'
  return /^https?:\/\//.test(v) ? v : `http://${v}`
}

function ensureSocket(url) {
  if (socket && socketUrl === url) return socket
  if (socket) {
    socket.removeAllListeners()
    socket.disconnect()
  }
  socketUrl = url
  socket = io(url, { transports: ['websocket'], reconnection: true, timeout: 8000 })
  bindSocket(socket)
  return socket
}

function bindSocket(s) {
  s.on('peer-joined', ({ peerId, name }) => {
    if (peerId === myId) return
    createPeer(peerId, name)
  })
  s.on('peer-left', ({ peerId }) => removePeer(peerId))
  s.on('signal', ({ from, data }) => handleSignal(from, data))

  s.on('connect', () => {
    setStatus('')
    if (roomId && myId && !$('room').hidden) {
      s.emit('join', { roomId, peerId: myId, name: myName }, (res) => {
        if (res && res.ok) {
          res.peers.forEach((p) => createPeer(p.peerId, p.name))
          if (localStream) {
            for (const st of peers.values()) {
              localStream.getTracks().forEach((t) => st.pc.addTrack(t, localStream))
            }
          }
        }
      })
    }
  })

  s.on('connect_error', () => {
    if (!$('room').hidden) setStatus('与服务器的连接中断，自动重试中…')
    else showError(`无法连接 ${socketUrl}，请检查服务器地址与网络`)
  })
}

function setStatus(text) {
  $('status').textContent = text
}

// ---------- 登录 / 房间 ----------

function showError(msg) {
  $('login-error').textContent = msg
}

const savedServer = localStorage.getItem('fp:ss-server')
if (savedServer) $('server').value = savedServer

function genCode() {
  const abc = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
  let s = ''
  for (let i = 0; i < 4; i++) s += abc[Math.floor(Math.random() * abc.length)]
  return s
}

$('create').onclick = () => {
  const code = genCode()
  $('room').value = code
  enterRoom(code)
}

$('join').onclick = () => {
  const code = $('room').value.trim().toUpperCase()
  if (!code) return showError('请输入房间码')
  enterRoom(code)
}

function enterRoom(targetRoom) {
  const name = $('name').value.trim()
  if (!name) return showError('请输入你的名字')

  const rawServer = $('server').value.trim() || 'localhost:3100'
  localStorage.setItem('fp:ss-server', rawServer)
  const url = normalizeServerUrl(rawServer)

  showError('')
  myName = name
  myId = crypto.randomUUID()
  roomId = targetRoom

  const s = ensureSocket(url)
  let acked = false
  s.emit('join', { roomId: targetRoom, peerId: myId, name }, (res) => {
    acked = true
    if (!res || !res.ok) return showError((res && res.error) || '加入失败')
    $('login').hidden = true
    $('room').hidden = false
    $('room-info').innerHTML = `房间 <b>${targetRoom}</b> · 我：${name} · 服务器 ${rawServer}`
    res.peers.forEach((p) => createPeer(p.peerId, p.name))
    renderGrid()
  })
  setTimeout(() => {
    if (!acked) showError(`无法连接 ${url} —— 若在其他机器上，服务器地址请填信令服务机器的局域网 IP`)
  }, 5000)
}

// ---------- WebRTC Mesh ----------

function createPeer(peerId, name) {
  if (peers.has(peerId)) return
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
  })
  const st = {
    pc,
    name,
    polite: myId > peerId,
    makingOffer: false,
    ignoreOffer: false,
    pendingCandidates: []
  }
  peers.set(peerId, st)

  pc.onicecandidate = (e) => {
    if (e.candidate) socket.emit('signal', { to: peerId, data: { candidate: e.candidate } })
  }

  pc.ontrack = (e) => {
    const stream = e.streams[0]
    const track = stream.getVideoTracks()[0]
    const show = () => {
      remoteStreams.set(peerId, stream)
      renderGrid()
    }
    const hide = () => {
      remoteStreams.delete(peerId)
      renderGrid()
    }
    if (track) {
      // 远端视频轨初始常为 muted（首帧未到），unmute 时才显示；mute 视为对方停止共享
      if (!track.muted) show()
      track.onunmute = show
      track.onmute = hide
    } else {
      show()
    }
  }

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed') {
      console.warn(`[pc] connection to ${name} failed, restarting ICE`)
      try {
        pc.restartIce()
      } catch (e) {
        console.error(e)
      }
    }
  }

  pc.onnegotiationneeded = async () => {
    try {
      st.makingOffer = true
      await pc.setLocalDescription()
      socket.emit('signal', { to: peerId, data: { description: pc.localDescription } })
    } catch (err) {
      console.error('negotiation error:', err)
    } finally {
      st.makingOffer = false
    }
  }

  if (localStream) localStream.getTracks().forEach((t) => pc.addTrack(t, localStream))

  renderGrid()
}

async function handleSignal(from, data) {
  const st = peers.get(from)
  if (!st) return
  const { pc, polite } = st
  try {
    if (data.description) {
      const offerCollision =
        data.description.type === 'offer' && (st.makingOffer || pc.signalingState !== 'stable')
      st.ignoreOffer = !polite && offerCollision
      if (st.ignoreOffer) return

      await pc.setRemoteDescription(data.description)
      const pending = st.pendingCandidates.splice(0)
      for (const c of pending) await pc.addIceCandidate(c).catch(() => {})

      if (data.description.type === 'offer') {
        await pc.setLocalDescription()
        socket.emit('signal', { to: from, data: { description: pc.localDescription } })
      }
    } else if (data.candidate) {
      if (!pc.remoteDescription) st.pendingCandidates.push(data.candidate)
      else await pc.addIceCandidate(data.candidate).catch(() => {})
    }
  } catch (err) {
    console.error('signal error:', err)
  }
}

function removePeer(peerId) {
  const st = peers.get(peerId)
  if (st) {
    st.pc.close()
    peers.delete(peerId)
  }
  remoteStreams.delete(peerId)
  renderGrid()
}

// ---------- 屏幕共享控制 ----------

async function startShare() {
  try {
    localStream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 15 },
      audio: false
    })
    localStream.getVideoTracks()[0].onended = stopShare
    for (const st of peers.values()) {
      localStream.getTracks().forEach((t) => st.pc.addTrack(t, localStream))
    }
    $('share').textContent = '停止共享'
    $('share').onclick = stopShare
    renderGrid()
  } catch (err) {
    alert('共享失败：' + err.message)
  }
}

function stopShare() {
  if (!localStream) return
  for (const st of peers.values()) {
    st.pc.getSenders().forEach((s) => {
      if (s.track) st.pc.removeTrack(s)
    })
  }
  localStream.getTracks().forEach((t) => t.stop())
  localStream = null
  $('share').textContent = '开始共享屏幕'
  $('share').onclick = startShare
  renderGrid()
}

$('share').onclick = startShare

$('leave').onclick = () => {
  stopShare()
  for (const [, st] of peers) st.pc.close()
  peers.clear()
  remoteStreams.clear()
  if (socket && socket.connected) socket.emit('leave')
  roomId = null
  $('room').hidden = true
  $('login').hidden = false
  renderGrid()
}

// ---------- 渲染：远端主区域 + 本机底部预览 ----------

/** 读取视频轨的真实分辨率/帧率 */
function fmtTrackInfo(stream) {
  const track = stream && stream.getVideoTracks()[0]
  if (!track) return ''
  const s = track.getSettings()
  const fps = s.frameRate ? `@${Math.round(s.frameRate)}fps` : ''
  return s.width && s.height ? ` ${s.width}×${s.height}${fps}` : ''
}

function renderGrid() {
  const grid = $('grid')
  grid.innerHTML = ''
  const tiles = []
  for (const [peerId, stream] of remoteStreams) {
    const st = peers.get(peerId)
    tiles.push({ label: st ? st.name : peerId, stream })
  }
  if (tiles.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'empty'
    empty.textContent = '暂无他人共享画面 —— 队友各自点击「开始共享屏幕」后出现在这里'
    grid.appendChild(empty)
  } else {
    for (const t of tiles) {
      const cell = document.createElement('div')
      cell.className = 'cell'
      const video = document.createElement('video')
      video.autoplay = true
      video.playsInline = true
      video.srcObject = t.stream
      const label = document.createElement('div')
      label.className = 'label'
      label.textContent = t.label + fmtTrackInfo(t.stream)
      cell.appendChild(video)
      cell.appendChild(label)
      grid.appendChild(cell)
    }
  }

  // 本机预览（底部固定条）
  const wrap = $('localwrap')
  const noLocal = $('no-local')
  if (localStream) {
    wrap.hidden = false
    noLocal.hidden = true
    const v = $('localvideo')
    if (v.srcObject !== localStream) v.srcObject = localStream
    const localLabel = wrap.querySelector('.label')
    if (localLabel) localLabel.textContent = `我（本机屏幕）${fmtTrackInfo(localStream)}`
  } else {
    wrap.hidden = true
    noLocal.hidden = false
  }
}

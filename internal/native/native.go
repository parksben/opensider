package native

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"io"
	"os"
	"sync"

	"github.com/parksben/opensider/internal/log"
)

// maxMessage 是发送侧上限：Chrome 对 Host→扩展方向的硬限制就是 1MB。
const maxMessage = 1024 * 1024

// maxIncoming 是读取侧允许的单帧上限。浏览器→Host 方向 Chrome 没有 1MB 限制，
// 旧版扩展还在发 >1MB 的单帧 `ui.state.set`（等它重载前不该白丢），所以先收下，
// 空态守卫照旧在 uistate.Save 里把关。
const maxIncoming = 16 << 20

// maxSkipFrame 是「按声明长度跳过超限帧」的上限。超过它的长度基本可以断定不是
// 帧头（流已经错位，或对端失控），继续吞字节只会把僵死拖长，直接断开让 SW 重连。
const maxSkipFrame = 64 << 20

type IO struct {
	onMessage func(msg map[string]any)
	mu        sync.Mutex
	Done      chan struct{}
}

func New(onMessage func(msg map[string]any)) *IO {
	n := &IO{onMessage: onMessage, Done: make(chan struct{})}
	go n.readLoop()
	return n
}

// framer 把 Native Messaging 的字节流切成帧。单独拆出来是因为读取端出过错：
// 早期实现对超限帧直接清空缓冲，而缓冲里往往还夹着同一帧的后续字节——被清掉后，
// 它们的中间几个字节会被当成新的长度前缀，流从此永久错位（日志里成片的乱码长度
// 就是 JSON 文本片段，2026-09-18 的镜像停更事故）。跳过超限帧必须按
// 「4 字节前缀 + ln 字节负载」的精确长度呑，才能保证下一帧从正确边界开始。
type framer struct {
	buf  []byte
	skip int64
}

// feed 追加数据并吐出完整帧。oversized 是本次被跳过的超限帧的声明长度列表；
// overflow 表示遇到了大到不能跳的帧头，调用方应当断开这条连接。
func (f *framer) feed(data []byte) (frames [][]byte, oversized []int, overflow bool) {
	f.buf = append(f.buf, data...)
	for {
		if f.skip > 0 {
			n := int64(len(f.buf))
			if n > f.skip {
				n = f.skip
			}
			f.buf = f.buf[n:]
			f.skip -= n
			if f.skip > 0 {
				return frames, oversized, false
			}
		}
		if len(f.buf) < 4 {
			return frames, oversized, false
		}
		ln := binary.LittleEndian.Uint32(f.buf[:4])
		if ln > maxIncoming {
			total := int64(ln) + 4
			if total > maxSkipFrame {
				return frames, oversized, true
			}
			oversized = append(oversized, int(ln))
			n := total
			if int64(len(f.buf)) < n {
				n = int64(len(f.buf))
			}
			f.buf = f.buf[n:]
			f.skip = total - n
			if f.skip > 0 {
				return frames, oversized, false
			}
			continue
		}
		if uint32(len(f.buf)) < 4+ln {
			return frames, oversized, false
		}
		raw := f.buf[4 : 4+ln]
		f.buf = f.buf[4+ln:]
		frames = append(frames, raw)
	}
}

func (n *IO) readLoop() {
	defer close(n.Done)
	var f framer
	tmp := make([]byte, 64*1024)
	for {
		nr, err := os.Stdin.Read(tmp)
		if nr > 0 {
			frames, oversized, overflow := f.feed(tmp[:nr])
			for _, ln := range oversized {
				log.Log("native oversized frame skipped: " + itoa(ln))
			}
			if overflow {
				log.Log("native frame header too large to skip; dropping connection")
				return
			}
			for _, raw := range frames {
				var msg map[string]any
				if err := json.Unmarshal(raw, &msg); err != nil {
					log.Log("native parse error: " + err.Error())
					continue
				}
				n.onMessage(msg)
			}
		}
		if err != nil {
			if err != io.EOF {
				log.Log("native stdin error: " + err.Error())
			}
			return
		}
	}
}

func (n *IO) Send(msg any) {
	jsonBytes, err := Marshal(msg)
	if err != nil {
		log.Log("native marshal error: " + err.Error())
		return
	}
	if len(jsonBytes) > maxMessage {
		log.Log("native message too large: " + itoa(len(jsonBytes)))
		return
	}
	frame := make([]byte, 4+len(jsonBytes))
	binary.LittleEndian.PutUint32(frame[:4], uint32(len(jsonBytes)))
	copy(frame[4:], jsonBytes)
	n.mu.Lock()
	defer n.mu.Unlock()
	if err := writeAll(os.Stdout, frame); err != nil {
		log.Log("native write: " + err.Error())
	}
}

// Marshal 按 Native Messaging 的线上口径序列化：不转义 HTML（`<`、`>`、`&` 保持一字节），
// 无尾随换行。默认的 json.Marshal 会把它们撑成 `\u003c` 六字节——状态镜像这种对体积敏感
// 的消息正是被这层「保护」顶过了 1MB 单帧上限（2026-09-18 事故：1,048,513B 的状态在发送
// 侧被撑到 1,099,121B 而静默丢弃）。扩展侧拿到的是 JS 对象，转义与否语义完全一样。
func Marshal(v any) ([]byte, error) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		return nil, err
	}
	return bytes.TrimSuffix(buf.Bytes(), []byte{'\n'}), nil
}

func writeAll(w io.Writer, raw []byte) error {
	for len(raw) > 0 {
		n, err := w.Write(raw)
		if n > 0 {
			raw = raw[n:]
		}
		if err != nil {
			return err
		}
		if n == 0 {
			return io.ErrShortWrite
		}
	}
	return nil
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b [20]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	return string(b[i:])
}

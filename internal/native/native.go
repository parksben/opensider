package native

import (
	"encoding/binary"
	"encoding/json"
	"io"
	"os"
	"sync"

	"github.com/parksben/opensider/internal/log"
)

const maxMessage = 1024 * 1024

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

func (n *IO) readLoop() {
	defer close(n.Done)
	var buf []byte
	tmp := make([]byte, 64*1024)
	for {
		nr, err := os.Stdin.Read(tmp)
		if nr > 0 {
			buf = append(buf, tmp[:nr]...)
			for len(buf) >= 4 {
				ln := binary.LittleEndian.Uint32(buf[:4])
				if ln > maxMessage {
					log.Log("native message too large: " + itoa(int(ln)))
					buf = buf[:0]
					break
				}
				if uint32(len(buf)) < 4+ln {
					break
				}
				raw := buf[4 : 4+ln]
				buf = buf[4+ln:]
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
	jsonBytes, err := json.Marshal(msg)
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

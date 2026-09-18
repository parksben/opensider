package native

import (
	"encoding/binary"
	"strings"
	"testing"
)

func frameBytes(payload string) []byte {
	out := make([]byte, 4+len(payload))
	binary.LittleEndian.PutUint32(out[:4], uint32(len(payload)))
	copy(out[4:], payload)
	return out
}

func feedInChunks(t *testing.T, f *framer, stream []byte) (frames []string, oversized []int) {
	t.Helper()
	for i := 0; i < len(stream); i += 64 * 1024 {
		end := i + 64 * 1024
		if end > len(stream) {
			end = len(stream)
		}
		partFrames, partOversized, overflow := f.feed(stream[i:end])
		if overflow {
			t.Fatal("unexpected overflow")
		}
		oversized = append(oversized, partOversized...)
		for _, raw := range partFrames {
			frames = append(frames, string(raw))
		}
	}
	return frames, oversized
}

func TestFramerParsesFramesSplitAcrossFeeds(t *testing.T) {
	a := frameBytes(`{"type":"a"}`)
	b := frameBytes(`{"type":"b"}`)
	stream := append(append([]byte{}, a...), b...)

	var f framer
	var got []string
	for _, part := range [][]byte{stream[:3], stream[3:9], stream[9:]} {
		frames, _, overflow := f.feed(part)
		if overflow {
			t.Fatal("unexpected overflow")
		}
		for _, raw := range frames {
			got = append(got, string(raw))
		}
	}
	if len(got) != 2 || got[0] != `{"type":"a"}` || got[1] != `{"type":"b"}` {
		t.Fatalf("frames did not survive split feeds: %q", got)
	}
}

// 回归：超限帧必须按声明长度吞掉、且不影响后面的帧。旧实现遇到超限帧直接清空缓冲，
// 把同一条帧的后续字节当成长度前缀读，流从此刻起永久错位（日志里成片的乱码长度）。
func TestFramerSkipsOversizedFrameAndResyncs(t *testing.T) {
	huge := make([]byte, maxIncoming+64*1024)
	for i := range huge {
		huge[i] = 'x'
	}
	stream := append(append([]byte{}, frameBytes(string(huge))...), frameBytes(`{"type":"after"}`)...)

	var f framer
	got, oversized := feedInChunks(t, &f, stream)
	if len(oversized) != 1 || oversized[0] != len(huge) {
		t.Fatalf("want the oversized frame reported once, got %v", oversized)
	}
	if len(got) != 1 || got[0] != `{"type":"after"}` {
		t.Fatalf("the frame after an oversized one must still parse, got %q", got)
	}
}

// 旧版扩展还在发略超 1MB 的单帧状态：读取侧要收下（发送侧 1MB 上限只约束 Host→扩展）。
func TestFramerAcceptsFramesOverOneMegabyte(t *testing.T) {
	payload := `{"blob":"` + strings.Repeat("x", maxMessage+64*1024) + `"}`
	var f framer
	got, oversized := feedInChunks(t, &f, frameBytes(payload))
	if len(oversized) != 0 {
		t.Fatalf("a slightly-oversized incoming frame must be accepted, got %v", oversized)
	}
	if len(got) != 1 || got[0] != payload {
		t.Fatal("the incoming frame did not survive")
	}
}

func TestFramerOverflowOnAbsurdHeader(t *testing.T) {
	raw := make([]byte, 8)
	binary.LittleEndian.PutUint32(raw[:4], uint32(maxSkipFrame))
	if _, _, overflow := (&framer{}).feed(raw); !overflow {
		t.Fatal("a frame too large to skip must overflow")
	}
}

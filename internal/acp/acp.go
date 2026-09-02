package acp

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"sync"
	"sync/atomic"

	"github.com/parksben/opensider/internal/detect"
	"github.com/parksben/opensider/internal/log"
	"github.com/parksben/opensider/internal/paths"
	"github.com/parksben/opensider/internal/protocol"
)

type Launch struct {
	Command string
	Args    []string
	Cwd     string
	Env     map[string]string
	Auth    detect.AuthKind
	Profile detect.AgentProfile
}

type SessionOpen struct {
	SessionID     string
	Replay        bool
	Created       bool
	Forked        bool
	ConfigOptions any
	Models        any
}

type Handlers struct {
	OnUpdate     func(update map[string]any, sessionID string)
	OnPermission func(id int, params map[string]any, sessionID string)
	OnCursor     func(id *int, method string, params map[string]any, sessionID string)
}

type rpcWaiter struct {
	ch chan rpcResult
}

type rpcResult struct {
	result any
	err    error
}

type Client struct {
	launch   Launch
	handlers Handlers
	mu       sync.Mutex
	cmd      *exec.Cmd
	stdin    io.WriteCloser
	nextID   atomic.Int64
	pending  map[int]rpcWaiter
	session  string
	policy   protocol.AgentPolicy
}

func New(launch Launch, handlers Handlers) *Client {
	c := &Client{
		launch:   launch,
		handlers: handlers,
		pending:  map[int]rpcWaiter{},
		policy:   protocol.PolicyAsk,
	}
	c.nextID.Store(1)
	return c
}

func (c *Client) SetPolicy(policy protocol.AgentPolicy) {
	c.mu.Lock()
	c.policy = policy
	sessionID := c.session
	c.mu.Unlock()
	if sessionID != "" {
		go c.trySetPolicyMode(sessionID)
	}
}

func (c *Client) GetSessionID() string {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.session
}

func (c *Client) Start() error {
	if _, err := os.Stat(c.launch.Command); err != nil {
		return fmt.Errorf("%s CLI not found at %s. %s", c.launch.Profile.Name, c.launch.Command, c.launch.Profile.LoginHint)
	}
	cmd := exec.Command(c.launch.Command, c.launch.Args...)
	cmd.Dir = c.launch.Cwd
	env := os.Environ()
	env = setEnv(env, "HOME", paths.Home())
	env = setEnv(env, "PATH", paths.AgentPathEnv(c.launch.Command))
	for k, v := range c.launch.Env {
		env = setEnv(env, k, v)
	}
	cmd.Env = env
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return err
	}
	if err := cmd.Start(); err != nil {
		return err
	}
	c.mu.Lock()
	c.cmd = cmd
	c.stdin = stdin
	c.mu.Unlock()

	go func() {
		sc := bufio.NewScanner(stderr)
		sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
		for sc.Scan() {
			line := strings.TrimSpace(sc.Text())
			if line != "" {
				log.Log("agent stderr: " + line)
			}
		}
	}()
	go func() {
		sc := bufio.NewScanner(stdout)
		sc.Buffer(make([]byte, 0, 64*1024), 4*1024*1024)
		for sc.Scan() {
			line := strings.TrimSpace(sc.Text())
			if line == "" {
				continue
			}
			var msg map[string]any
			if err := json.Unmarshal([]byte(line), &msg); err != nil {
				log.Log("unparsable agent line: " + trim(line, 200))
				continue
			}
			c.handleMessage(msg)
		}
		_ = cmd.Wait()
		log.Log("agent exited")
		c.failAll(errors.New("agent process exited"))
	}()
	return nil
}

func (c *Client) Initialize() error {
	meta := map[string]any{"parameterizedModelPicker": true}
	_, err := c.request("initialize", map[string]any{
		"protocolVersion": 1,
		"clientCapabilities": map[string]any{
			"fs":       map[string]any{"readTextFile": false, "writeTextFile": false},
			"terminal": false,
			"session":  map[string]any{"configOptions": map[string]any{"boolean": map[string]any{}}},
			"_meta":    meta,
		},
		"clientInfo": map[string]any{"name": "opensider", "version": "0.1.0"},
	})
	if err != nil {
		return err
	}
	if c.launch.Auth.Type == "method" {
		if _, err := c.request("authenticate", map[string]any{"methodId": c.launch.Auth.MethodID}); err != nil {
			return fmt.Errorf("%s (%v)", c.launch.Profile.LoginHint, err)
		}
	}
	return nil
}

func (c *Client) CreateSession() (SessionOpen, error) {
	result, err := c.request("session/new", map[string]any{
		"cwd":        c.launch.Cwd,
		"mcpServers": []any{},
	})
	if err != nil {
		return SessionOpen{}, err
	}
	obj, _ := result.(map[string]any)
	sessionID := str(obj["sessionId"])
	c.mu.Lock()
	c.session = sessionID
	c.mu.Unlock()
	c.trySetPolicyMode(sessionID)
	return SessionOpen{
		SessionID:     sessionID,
		Replay:        false,
		Created:       true,
		Forked:        false,
		ConfigOptions: obj["configOptions"],
		Models:        obj["models"],
	}, nil
}

func (c *Client) UseSession(existingID string) (SessionOpen, error) {
	if c.GetSessionID() == existingID {
		return SessionOpen{SessionID: existingID, Replay: true}, nil
	}
	result, err := c.request("session/load", map[string]any{
		"sessionId":  existingID,
		"cwd":        c.launch.Cwd,
		"mcpServers": []any{},
	})
	if err != nil {
		log.Log("session/load failed, creating new: " + err.Error())
		return c.CreateSession()
	}
	obj, _ := result.(map[string]any)
	c.mu.Lock()
	c.session = existingID
	c.mu.Unlock()
	c.trySetPolicyMode(existingID)
	return SessionOpen{
		SessionID:     existingID,
		Replay:        true,
		Created:       false,
		Forked:        false,
		ConfigOptions: obj["configOptions"],
		Models:        obj["models"],
	}, nil
}

func (c *Client) ForkSession(existingID string) (SessionOpen, error) {
	result, err := c.request("session/fork", map[string]any{
		"sessionId":  existingID,
		"cwd":        c.launch.Cwd,
		"mcpServers": []any{},
	})
	if err != nil {
		log.Log("session/fork failed, creating new: " + err.Error())
		return c.CreateSession()
	}
	obj, _ := result.(map[string]any)
	sessionID := str(obj["sessionId"])
	c.mu.Lock()
	c.session = sessionID
	c.mu.Unlock()
	c.trySetPolicyMode(sessionID)
	return SessionOpen{
		SessionID:     sessionID,
		Replay:        false,
		Created:       true,
		Forked:        true,
		ConfigOptions: obj["configOptions"],
		Models:        obj["models"],
	}, nil
}

func (c *Client) SetModel(modelID, configID string) (any, error) {
	if c.GetSessionID() == "" {
		return nil, errors.New("no session")
	}
	if configID == "" {
		configID = "model"
	}
	result, err := c.request("session/set_config_option", map[string]any{
		"sessionId": c.GetSessionID(),
		"configId":  configID,
		"value":     modelID,
	})
	if err != nil {
		log.Log("session/set_config_option failed, trying session/set_model: " + err.Error())
		return c.request("session/set_model", map[string]any{
			"sessionId": c.GetSessionID(),
			"modelId":   modelID,
		})
	}
	return result, nil
}

func (c *Client) Prompt(text string) (string, error) {
	if c.GetSessionID() == "" {
		return "", errors.New("no session")
	}
	result, err := c.request("session/prompt", map[string]any{
		"sessionId": c.GetSessionID(),
		"prompt":    []any{map[string]any{"type": "text", "text": text}},
	})
	if err != nil {
		return "", err
	}
	obj, _ := result.(map[string]any)
	stop := str(obj["stopReason"])
	if stop == "" {
		stop = "end_turn"
	}
	return stop, nil
}

func (c *Client) Cancel() {
	session := c.GetSessionID()
	c.mu.Lock()
	running := c.cmd != nil
	c.mu.Unlock()
	if session == "" || !running {
		return
	}
	c.notify("session/cancel", map[string]any{"sessionId": session})
}

func (c *Client) Respond(id int, result any) {
	c.write(map[string]any{"jsonrpc": "2.0", "id": id, "result": result})
}

func (c *Client) Stop() {
	c.mu.Lock()
	stdin := c.stdin
	cmd := c.cmd
	c.mu.Unlock()
	if stdin != nil {
		_ = stdin.Close()
	}
	if cmd != nil && cmd.Process != nil {
		_ = cmd.Process.Kill()
	}
}

func (c *Client) trySetPolicyMode(sessionID string) {
	c.mu.Lock()
	ids := c.launch.Profile.ModeMap[c.policy]
	c.mu.Unlock()
	for _, modeID := range ids {
		if _, err := c.request("session/set_mode", map[string]any{"sessionId": sessionID, "modeId": modeID}); err != nil {
			log.Log("session/set_mode " + modeID + " skipped: " + err.Error())
			continue
		}
		return
	}
}

func (c *Client) handleMessage(msg map[string]any) {
	if id, ok := asInt(msg["id"]); ok {
		if _, hasResult := msg["result"]; hasResult || msg["error"] != nil {
			c.mu.Lock()
			waiter, found := c.pending[id]
			if found {
				delete(c.pending, id)
			}
			c.mu.Unlock()
			if !found {
				return
			}
			if msg["error"] != nil {
				raw, _ := json.Marshal(msg["error"])
				waiter.ch <- rpcResult{err: errors.New(string(raw))}
			} else {
				waiter.ch <- rpcResult{result: msg["result"]}
			}
			return
		}
	}

	method, _ := msg["method"].(string)
	params, _ := msg["params"].(map[string]any)
	if params == nil {
		params = map[string]any{}
	}
	sessionID := str(params["sessionId"])
	if sessionID == "" {
		sessionID = c.GetSessionID()
	}

	if method == "session/update" {
		update, _ := params["update"].(map[string]any)
		if update == nil {
			update = params
		}
		if c.handlers.OnUpdate != nil {
			c.handlers.OnUpdate(update, sessionID)
		}
		return
	}

	if method == "session/request_permission" {
		if id, ok := asInt(msg["id"]); ok && c.handlers.OnPermission != nil {
			c.handlers.OnPermission(id, params, sessionID)
		}
		return
	}

	for _, prefix := range c.launch.Profile.VendorPrefixes {
		if strings.HasPrefix(method, prefix) {
			var idPtr *int
			if id, ok := asInt(msg["id"]); ok {
				idPtr = &id
			}
			if c.handlers.OnCursor != nil {
				c.handlers.OnCursor(idPtr, method, params, sessionID)
			}
			return
		}
	}

	if id, ok := asInt(msg["id"]); ok {
		c.write(map[string]any{"jsonrpc": "2.0", "id": id, "result": map[string]any{}})
	}
}

func (c *Client) request(method string, params any) (any, error) {
	id := int(c.nextID.Add(1) - 1)
	ch := make(chan rpcResult, 1)
	c.mu.Lock()
	c.pending[id] = rpcWaiter{ch: ch}
	c.mu.Unlock()
	if err := c.write(map[string]any{"jsonrpc": "2.0", "id": id, "method": method, "params": params}); err != nil {
		c.mu.Lock()
		delete(c.pending, id)
		c.mu.Unlock()
		return nil, err
	}
	res := <-ch
	return res.result, res.err
}

func (c *Client) notify(method string, params any) {
	_ = c.write(map[string]any{"jsonrpc": "2.0", "method": method, "params": params})
}

func (c *Client) write(msg any) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.stdin == nil {
		return errors.New("agent is not running")
	}
	raw, err := json.Marshal(msg)
	if err != nil {
		return err
	}
	_, err = c.stdin.Write(append(raw, '\n'))
	return err
}

func (c *Client) failAll(err error) {
	c.mu.Lock()
	pending := c.pending
	c.pending = map[int]rpcWaiter{}
	c.mu.Unlock()
	for _, waiter := range pending {
		waiter.ch <- rpcResult{err: err}
	}
}

func setEnv(env []string, key, value string) []string {
	prefix := key + "="
	for i, item := range env {
		if strings.HasPrefix(item, prefix) {
			env[i] = prefix + value
			return env
		}
	}
	return append(env, prefix+value)
}

func str(v any) string {
	s, _ := v.(string)
	return s
}

func asInt(v any) (int, bool) {
	switch n := v.(type) {
	case float64:
		return int(n), true
	case int:
		return n, true
	case int64:
		return int(n), true
	case json.Number:
		i, err := n.Int64()
		return int(i), err == nil
	default:
		return 0, false
	}
}

func trim(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}

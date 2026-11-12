package host

import (
	"encoding/json"
	"fmt"

	"github.com/parksben/opensider/internal/log"
	"github.com/parksben/opensider/internal/uistate"
)

// restoreSessionBody sends an archived session's body back to the panel. The body
// lives in sessions/<id>.json; the active ui-state index only carries metadata, so
// the panel asks for it when the user restores a conversation. Host→extension
// frames are capped at 1MB, hence the same chunked transfer used by ui.state.
func (h *Host) restoreSessionBody(requestID, id string) {
	if requestID == "" || id == "" {
		return
	}
	body, ok := uistate.ReadSessionBody(id)
	if !ok {
		h.send(map[string]any{
			"type":      "session.restore",
			"requestId": requestID,
			"error":     "archive not found",
		})
		log.Log("session restore missing " + id)
		return
	}
	raw, err := json.Marshal(body)
	if err != nil {
		h.send(map[string]any{
			"type":      "session.restore",
			"requestId": requestID,
			"error":     "archive is unreadable",
		})
		log.Log("session restore marshal: " + err.Error())
		return
	}
	chunks := splitStateText(string(raw))
	for index, data := range chunks {
		h.send(map[string]any{
			"type":      "session.restore",
			"requestId": requestID,
			"index":     index,
			"total":     len(chunks),
			"data":      data,
		})
	}
	log.Log(fmt.Sprintf("session restore %s chunks=%d bytes=%d", id, len(chunks), len(raw)))
}

// archiveSessions moves a batch of sessions' bodies out of the active index. The
// panel asks for this only after it has persisted the bodies to the host, but the
// host still re-checks each body file before dropping it: a session that was never
// mirrored (fresh host data, a failed save) is skipped and stays active.
func (h *Host) archiveSessions(requestID string, ids []string) {
	if requestID == "" || len(ids) == 0 {
		return
	}
	archivedAt, archived, skipped, err := uistate.ArchiveSessions(ids)
	reply := map[string]any{
		"type":      "session.archived",
		"requestId": requestID,
		"ids":       archived,
	}
	if archivedAt != "" {
		reply["archivedAt"] = archivedAt
	}
	if len(skipped) > 0 {
		reply["skipped"] = skipped
	}
	if err != nil {
		reply["error"] = err.Error()
		log.Log("session archive: " + err.Error())
	}
	log.Log(fmt.Sprintf("session archive archived=%d skipped=%d", len(archived), len(skipped)))
	h.send(reply)
}

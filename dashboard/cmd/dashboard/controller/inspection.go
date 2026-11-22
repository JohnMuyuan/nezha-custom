package controller

import (
	"errors"
	"strconv"

	"github.com/gin-gonic/gin"

	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/singleton"
)

type runInspectionForm struct {
	Scopes []string `json:"scopes,omitempty"`
}

// GET /api/v1/server/inspections
func listServerInspections(c *gin.Context) (map[uint64]*model.InspectionSummary, error) {
	if singleton.InspectionShared == nil {
		return map[uint64]*model.InspectionSummary{}, nil
	}
	u, authorized := c.Get(model.CtxKeyAuthorizedUser)
	var isAdmin bool
	var userID uint64
	if authorized {
		user := u.(*model.User)
		isAdmin = user.Role.IsAdmin()
		userID = user.ID
	}

	allowed := make(map[uint64]struct{})
	for _, server := range singleton.ServerShared.Range {
		if server == nil {
			continue
		}
		if !authorized && server.HideForGuest {
			continue
		}
		if authorized && !isAdmin && server.HideForGuest && server.UserID != userID {
			continue
		}
		allowed[server.ID] = struct{}{}
	}
	return singleton.InspectionShared.ListSummaries(allowed), nil
}

// GET /api/v1/server/:id/inspection
func getServerInspection(c *gin.Context) (*model.ServerInspectionPayload, error) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		return nil, errors.New("invalid server id")
	}
	server, ok := singleton.ServerShared.Get(id)
	if !ok || server == nil {
		return nil, errors.New("server not found")
	}
	u, authorized := c.Get(model.CtxKeyAuthorizedUser)
	if !authorized && server.HideForGuest {
		return nil, errors.New("server not found")
	}
	if authorized {
		user := u.(*model.User)
		if !user.Role.IsAdmin() && server.HideForGuest && server.UserID != user.ID {
			return nil, errors.New("server not found")
		}
	}
	if singleton.InspectionShared == nil {
		return &model.ServerInspectionPayload{ServerID: id}, nil
	}
	return singleton.InspectionShared.Get(id), nil
}

// POST /api/v1/server/:id/inspection/run (admin required)
func runServerInspection(c *gin.Context) (any, error) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		return nil, errors.New("invalid server id")
	}
	var form runInspectionForm
	_ = c.ShouldBindJSON(&form)
	if singleton.InspectionShared == nil {
		return nil, errors.New("inspection service unavailable")
	}
	if err := singleton.InspectionShared.TriggerServer(id, form.Scopes); err != nil {
		return nil, err
	}
	return gin.H{"server_id": id, "started": true}, nil
}

// POST /api/v1/server/inspections/run-all (admin required)
func runAllServerInspections(c *gin.Context) (any, error) {
	var form runInspectionForm
	_ = c.ShouldBindJSON(&form)
	if singleton.InspectionShared == nil {
		return nil, errors.New("inspection service unavailable")
	}
	queued := singleton.InspectionShared.TriggerAllOnline(form.Scopes)
	return gin.H{"queued": queued}, nil
}

// POST /api/v1/setting/expiry-notify/test (admin required)
func testExpiryNotification(c *gin.Context) (any, error) {
	count, msg, err := singleton.CheckAndSendExpiryNotifications(true)
	if err != nil {
		return nil, err
	}
	return gin.H{"matched": count, "message": msg}, nil
}

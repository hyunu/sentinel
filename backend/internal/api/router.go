package api

import (
	"github.com/gin-gonic/gin"
	"github.com/hyunu/sentinel/internal/db"
	"go.uber.org/zap"
)

func SetupRouter(database *db.MongoDB, logger *zap.Logger) *gin.Engine {
	r := gin.Default()
	h := NewHandler(database, logger)

	v1 := r.Group("/api/v1")
	{
		boards := v1.Group("/boards")
		{
			boards.POST("/register", h.RegisterBoard)
			boards.GET("", h.ListBoards)
			boards.GET("/:id", h.GetBoard)
			boards.PUT("/:id", h.UpdateBoard)
		}

		v1.POST("/heartbeat", h.Heartbeat)

		data := v1.Group("/data")
		{
			data.POST("/uart", h.IngestUART)
			data.POST("/uart/batch", h.IngestUARTBatch)
			data.GET("/uart", h.QueryUART)
			data.POST("/temperature", h.IngestTemperature)
			data.GET("/temperature", h.QueryTemperature)
		}

		protocols := v1.Group("/protocols")
		{
			protocols.POST("", h.CreateProtocol)
			protocols.GET("", h.ListProtocols)
			protocols.GET("/:id", h.GetProtocol)
			protocols.PUT("/:id", h.UpdateProtocol)
			protocols.DELETE("/:id", h.DeleteProtocol)
		}

		sessions := v1.Group("/sessions")
		{
			sessions.POST("", h.CreateSession)
			sessions.GET("", h.ListSessions)
			sessions.PUT("/:id", h.UpdateSession)
			sessions.DELETE("/:id", h.DeleteSession)
			sessions.POST("/auto-split", h.AutoSplitSessions)
		}

		viz := v1.Group("/viz")
		{
			viz.POST("/profiles", h.CreateVizProfile)
			viz.GET("/profiles", h.ListVizProfiles)
			viz.GET("/profiles/:id", h.GetVizProfile)
			viz.PUT("/profiles/:id", h.UpdateVizProfile)
			viz.DELETE("/profiles/:id", h.DeleteVizProfile)
			viz.POST("/profiles/:id/apply", h.ApplyVizProfile)
			viz.POST("/query", h.VizQuery)
		}

		v1.POST("/ai/query", h.AIQuery)
	}

	return r
}

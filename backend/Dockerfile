FROM golang:1.26-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o sentinel-server ./cmd/server/

FROM alpine:3.20
RUN apk add --no-cache ca-certificates
COPY --from=builder /app/sentinel-server /usr/local/bin/sentinel-server
EXPOSE 5050
CMD ["sentinel-server"]

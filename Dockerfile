# syntax=docker/dockerfile:1

# ==============================================================================
# Stage 1: Build local frontend-user (hamster1963/nezha-dash-v2)
# ==============================================================================
FROM --platform=$BUILDPLATFORM node:22-alpine AS frontend-user-builder
WORKDIR /src/frontend-user
RUN npm install -g pnpm@11.5.1
COPY frontend-user/package.json frontend-user/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY frontend-user/ ./
RUN pnpm run build

# ==============================================================================
# Stage 2: Build local frontend-admin (nezhahq/admin-frontend)
# ==============================================================================
FROM --platform=$BUILDPLATFORM node:22-alpine AS frontend-admin-builder
WORKDIR /src/frontend-admin
COPY frontend-admin/package.json frontend-admin/package-lock.json ./
RUN npm ci
COPY frontend-admin/ ./
RUN npm run build-ignore-error

# ==============================================================================
# Stage 3: Build Dashboard Go binary (with embedded frontends)
# ==============================================================================
FROM golang:1.26-alpine AS dashboard-builder

ARG VERSION=custom
ARG WITH_COMMUNITY_THEMES=false
ARG IPINFO_TOKEN=""

ENV GOTOOLCHAIN=auto

RUN apk add --no-cache build-base bash git curl unzip yq-go

WORKDIR /src
COPY dashboard/ ./dashboard/
COPY scripts/prepare-frontends.sh ./scripts/prepare-frontends.sh

# Inject locally built user & admin frontends
COPY --from=frontend-user-builder /src/frontend-user/dist/ ./dashboard/cmd/dashboard/user-dist/
COPY --from=frontend-admin-builder /src/frontend-admin/dist/ ./dashboard/cmd/dashboard/admin-dist/

# Optionally download extra community themes listed in frontend-templates.yaml
RUN if [ "$WITH_COMMUNITY_THEMES" = "true" ]; then \
      bash ./scripts/prepare-frontends.sh --community-only; \
    fi

# Optionally fetch IPInfo GeoIP country database
RUN if [ -n "$IPINFO_TOKEN" ]; then \
      curl -fsSL "https://ipinfo.io/data/free/country.mmdb?token=${IPINFO_TOKEN}" -o ./dashboard/pkg/geoip/geoip.db; \
    fi

WORKDIR /src/dashboard
RUN go install github.com/swaggo/swag/cmd/swag@v1.16.6 \
    && swag init --pd -d cmd/dashboard -g main.go -o cmd/dashboard/docs \
    && go mod tidy

RUN CGO_ENABLED=1 go build \
      -trimpath \
      -buildvcs=false \
      -tags="go_json,musl" \
      -ldflags "-s -w -X github.com/nezhahq/nezha/service/singleton.Version=${VERSION} -linkmode external -extldflags '-static'" \
      -o /out/app \
      ./cmd/dashboard

# ==============================================================================
# Stage 4: Minimal runtime image
# ==============================================================================
FROM alpine:latest AS certs
RUN apk add --no-cache ca-certificates tzdata

FROM busybox:stable-musl
COPY --from=certs /etc/ssl/certs /etc/ssl/certs
COPY --from=certs /usr/share/zoneinfo /usr/share/zoneinfo
COPY dashboard/script/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

WORKDIR /dashboard
COPY --from=dashboard-builder /out/app ./app

VOLUME ["/dashboard/data"]
EXPOSE 8008
ARG TZ=Asia/Shanghai
ENV TZ=$TZ
ENTRYPOINT ["/entrypoint.sh"]

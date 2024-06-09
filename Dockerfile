FROM node:bookworm-slim as builder

# Download tini to correctly handle signals for Node.js
ARG TINI_VERSION=v0.19.0
ARG TARGETARCH
ADD https://github.com/krallin/tini/releases/download/${TINI_VERSION}/tini-static-${TARGETARCH} /tini

# Copy and build app
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Final image
FROM gcr.io/distroless/nodejs20-debian12
COPY --from=builder --chmod=544 /tini /bin/tini
WORKDIR /app
COPY --from=builder /app/dist/index.js /app/index.js
ENTRYPOINT ["/bin/tini", "--", "/nodejs/bin/node"]
CMD ["/app/index.js"]

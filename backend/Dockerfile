FROM node:20-bookworm-slim

# ffmpeg for media, fonts for captions/watermarks (incl. Yoruba/Igbo diacritics), yt-dlp for link imports.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core fontconfig python3 python3-pip ca-certificates \
  && pip3 install --no-cache-dir --break-system-packages yt-dlp \
  && rm -rf /var/lib/apt/lists/*

# Optional: Demucs gives the best music/voice separation but adds ~2GB (PyTorch).
# Build with: docker compose build --build-arg INSTALL_DEMUCS=true backend
ARG INSTALL_DEMUCS=false
RUN if [ "$INSTALL_DEMUCS" = "true" ]; then pip3 install --no-cache-dir --break-system-packages demucs; fi

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .

ENV PORT=8000 NODE_ENV=production
EXPOSE 8000
CMD ["npm", "start"]

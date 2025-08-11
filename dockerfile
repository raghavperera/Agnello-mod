# Dockerfile - builds whisper.cpp and runs your node bot
FROM node:18-bullseye

# 1) system deps
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y \
  git build-essential cmake ffmpeg wget ca-certificates python3 \
  && rm -rf /var/lib/apt/lists/*

# 2) clone and build whisper.cpp
WORKDIR /opt
RUN git clone https://github.com/ggerganov/whisper.cpp.git /opt/whisper.cpp
WORKDIR /opt/whisper.cpp
RUN cmake -B build && cmake --build build -j

# 3) (optional) download model at build time. 
# Set MODEL_URL as a build-time ARG or Render env var. Use a small model for testing.
ARG MODEL_URL=""
RUN if [ -n "$MODEL_URL" ]; then mkdir -p /opt/whisper.cpp/models && \
    wget -O /opt/whisper.cpp/models/ggml-small.bin "$MODEL_URL"; fi

# 4) app
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .

# 5) expose port (optional)
ENV PORT=3000
EXPOSE 3000

# 6) start
CMD ["node", "index.js"]
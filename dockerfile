FROM node:18-bullseye

RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y \
  git build-essential cmake ffmpeg wget ca-certificates python3 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /opt
RUN git clone https://github.com/ggerganov/whisper.cpp.git /opt/whisper.cpp
WORKDIR /opt/whisper.cpp
RUN cmake -B build && cmake --build build -j$(nproc)

# Download model during build (small model for testing)
ARG MODEL_URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/models/ggml-small.bin"
RUN mkdir -p /opt/whisper.cpp/models && wget -O /opt/whisper.cpp/models/ggml-small.bin "$MODEL_URL"

WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .

ENV WHISPER_CLI=/opt/whisper.cpp/build/bin/whisper-cli

CMD ["node", "index.js"]
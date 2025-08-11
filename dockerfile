# Use official Node.js 18 image based on Debian bullseye
FROM node:18-bullseye

# Install system dependencies
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y \
  git build-essential cmake ffmpeg wget ca-certificates python3 \
  && rm -rf /var/lib/apt/lists/*

# Clone whisper.cpp repo and build it
WORKDIR /opt
RUN git clone https://github.com/ggerganov/whisper.cpp.git /opt/whisper.cpp
WORKDIR /opt/whisper.cpp
RUN cmake -B build && cmake --build build -j$(nproc)

# Download whisper model during build if MODEL_URL is set
ARG MODEL_URL=""
RUN if [ -n "$MODEL_URL" ]; then \
    mkdir -p /opt/whisper.cpp/models && \
    wget -O /opt/whisper.cpp/models/ggml-small.bin "$MODEL_URL"; \
  fi

# Set working directory for your bot code
WORKDIR /app

# Copy package.json & package-lock.json (if exists) and install dependencies
COPY package*.json ./
RUN npm install --production

# Copy rest of your bot source code
COPY . .

# Expose port (optional, if your bot uses web server or health checks)
ENV PORT=3000
EXPOSE 3000

# Set environment variable for whisper-cli path (optional)
ENV WHISPER_CLI=/opt/whisper.cpp/build/bin/whisper-cli

# Start your bot
CMD ["node", "index.js"]
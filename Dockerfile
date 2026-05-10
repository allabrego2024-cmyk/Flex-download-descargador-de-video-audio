FROM node:20-slim

# Instalar dependencias del sistema
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    ffmpeg \
    wget \
    && rm -rf /var/lib/apt/lists/*

# Instalar yt-dlp
RUN pip3 install --no-cache-dir yt-dlp

# Crear directorio de trabajo
WORKDIR /app

# Copiar package.json e instalar dependencias
COPY backend/package.json ./
RUN npm install --production

# Copiar el resto del código
COPY backend/ ./
COPY frontend/ ./frontend/

# Crear directorio de descargas
RUN mkdir -p downloads/mp3 downloads/mp4

# Puerto
EXPOSE 3000

# Iniciar servidor
CMD ["node", "server.js"]
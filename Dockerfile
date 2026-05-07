FROM node:20-slim

# Update package manager
RUN apt-get update && apt-get upgrade -y

# Install FFmpeg with all required dependencies
RUN apt-get install -y --no-install-recommends \
    ffmpeg \
    fonts-dejavu-core \
    fontconfig \
    ca-certificates

# Verify FFmpeg installation
RUN which ffmpeg && \
    ffmpeg -version && \
    ffprobe -version && \
    echo "✓ FFmpeg successfully installed at: $(which ffmpeg)"

WORKDIR /app

# Install Node dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy application code
COPY . .

# Create required directories with proper permissions
RUN mkdir -p uploads output temp && \
    chmod 777 uploads output temp

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:8080/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

EXPOSE 8080

# Run the application
CMD ["node", "index.js"]

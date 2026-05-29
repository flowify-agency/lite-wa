# Use a lightweight official Node runtime as parent
FROM node:22-slim

# Install Chromium and exact system dependencies required by Puppeteer
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    xdg-utils \
    dumb-init \
    && rm -rf /var/lib/apt/lists/*

# Configure Puppeteer to use the container-installed Chromium and skip downloading its own heavy binary
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PORT=3000

# Create application directory
WORKDIR /usr/src/app

# Copy dependency manifests
COPY package*.json ./

# Install production dependencies only and clear cache
RUN npm ci --omit=dev && npm cache clean --force

# Copy rest of the code (respecting .gitignore)
COPY . .

# Expose server port
EXPOSE 3000

# Run with dumb-init to properly forward OS signals and close Chromium cleanly
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "index.js"]

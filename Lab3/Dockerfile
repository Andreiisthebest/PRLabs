# Multi-stage build for the Memory Scramble server
FROM node:22-alpine AS build

WORKDIR /app

# Install dependencies first to leverage Docker layer caching
COPY package*.json ./
RUN npm install

# Copy the rest of the project files
COPY tsconfig.json ./
COPY src ./src
COPY public ./public
COPY boards ./boards

# Compile TypeScript to JavaScript
RUN npm run compile


FROM node:22-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production \
    PORT=8080 \
    BOARD_FILE=boards/ab.txt

# Copy production artefacts
COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public
COPY --from=build /app/boards ./boards

EXPOSE 8080

ENTRYPOINT ["node", "--require", "source-map-support/register", "dist/src/server.js"]
CMD ["8080", "boards/ab.txt"]

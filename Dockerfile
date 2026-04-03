# Stage 1: Build stage
# We use a Node.js image to install dependencies and compile TypeScript to JavaScript
FROM node:20-alpine AS build

# Set the working directory inside the container
WORKDIR /app

# Copy package.json and package-lock.json
# We do this first to take advantage of Docker's layer caching
COPY package*.json ./

# Install all dependencies (including devDependencies needed for build)
RUN npm install

# Copy the rest of the application source code
COPY . .

# Run the build script to compile TypeScript to JavaScript (generates the dist folder)
RUN npm run build

# Stage 2: Production stage
# We start with a fresh Node.js image to keep the final image as small as possible
FROM node:20-alpine AS production

# Set the working directory
WORKDIR /app

# Copy only the compiled code from the build stage
COPY --from=build /app/dist ./dist
# Copy package files to install only production dependencies
COPY --from=build /app/package*.json ./

# Install only production dependencies (skips devDependencies)
RUN npm install --only=production

# Expose the port your app runs on (matching the PORT in your .env)
EXPOSE 5000

# Start the application
CMD ["node", "dist/server.js"]

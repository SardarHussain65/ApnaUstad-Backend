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

# Create a non-root user and group
RUN addgroup -S nodeapp && adduser -S nodeapp -G nodeapp

# Set the working directory and ensure it's owned by the non-root user
WORKDIR /app
RUN chown nodeapp:nodeapp /app

# Copy only the compiled code from the build stage
COPY --from=build --chown=nodeapp:nodeapp /app/dist ./dist
# Copy package files to install only production dependencies
COPY --from=build --chown=nodeapp:nodeapp /app/package*.json ./

# Install only production dependencies (skips devDependencies)
RUN npm install --only=production

# Set the application's default port within the container
ENV PORT=3000

# Switch to the non-root user
USER nodeapp

# Expose the port your app runs on (matching the application default)
EXPOSE 3000

# Start the application
CMD ["node", "dist/server.js"]

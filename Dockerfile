# Use official Node.js runtime as base image
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy application source code
COPY . .

# Create directory for static files
RUN mkdir -p public

# Copy static files
COPY public/ public/

# Expose the application port
EXPOSE 3000

# Start the application
CMD ["npm", "start"]

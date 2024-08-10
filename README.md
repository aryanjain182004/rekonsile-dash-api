# Rekonsile Dash API

## Description

Rekonsile Dash API is a Node.js application built with Express and TypeScript, designed to provide backend services for Rekonsile Dashboard. The application uses PM2 for process management, ensuring enhanced performance and reliability in production environments.

## Prerequisites

Before you begin, ensure you have the following installed on your system:

* Node.js (version 14.x or higher)
* npm (version 6.x or higher)
* TypeScript (globally installed)
* PM2 (globally installed)

## Installation

1. **Clone the Repository**

   ```bash
   git clone https://yourrepositoryurl.com/rekonsile-dash-api.git
   cd rekonsile-dash-api
   ```

2. **Install Dependencies**

   ```bash
   npm install
   ```

## Development

To run the application in development mode with hot reloading, use the following command:

```bash
npm run dev
```

## Building the Application

To compile TypeScript files into JavaScript in the `dist` directory, run:

```bash
npm run build
```

## Production Deployment

1. **Start the Application with PM2**

   ```bash
   npm run prod
   ```

2. **Stop the Application**

   ```bash
   npm run prod:stop
   ```

3. **Restart the Application**

   ```bash
   npm run prod:restart
   ```

4. **View Logs**

   ```bash
   npm run prod:logs
   ```

5. **Save PM2 Process Configuration**

   This ensures that PM2 restarts your application on reboot.

   ```bash
   npm run prod:save
   ```

## PM2 Startup and Log Rotation Setup

1. **Automatic Startup on System Boot**

   Configure PM2 to automatically start your application when the system boots.

   ```bash
   npm run pm2:startup
   ```

2. **Log Rotation Configuration**

   Set up log rotation to manage and rotate logs automatically.

   ```bash
   npm run pm2:logrotate
   ```

## Additional Information

* **Environment Variables**: Make sure to set up your environment variables as needed, either in an `.env` file or through your hosting service's environment configuration tools.
* **Security**: Always ensure your dependencies are up to date to avoid vulnerabilities, and implement proper security measures in your application code.

## Customizing the README

You can further customize this README by adding sections such as:

* **API Documentation**: Links to API documentation or how to generate it.
* **Testing**: How to run tests if you set up testing frameworks.
* **Contributing**: Guidelines for contributing to the repository.
* **License**: Information about the project's license.

This README template provides a comprehensive guide to setting up, developing, and deploying your Node.js application, making it easier for developers to understand and work with your project.
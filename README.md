# Habit Tracker

Simple Habit Tracker app split into:

- `frontend/` for the Vercel static site
- `backend/` for the Render Express API backed by MySQL

## Run locally

1. Install backend dependencies:

```bash
cd backend
npm install
```

2. Create `backend/.env` from `backend/.env.example` and set your MySQL credentials.

3. Start the backend:

```bash
cd backend
npm start
```

4. Open [frontend/index.html](/C:/Users/iamth/OneDrive/Desktop/HabitTracker/frontend/index.html) in a browser, or serve the `frontend/` folder with any static server.

The API will be available at `http://localhost:3000`.

## Environment variables

Required for persistence:

- `MYSQL_HOST`
- `MYSQL_PORT`
- `MYSQL_USER`
- `MYSQL_PASSWORD`
- `MYSQL_DATABASE`

Optional:

- `FRONTEND_ORIGIN`
- `PORT`

If MySQL is not configured, the UI can still load, but API persistence will not work.

## Vercel + Render deployment

This project is now set up for a split deployment:

1. Deploy the frontend on Vercel.
2. Deploy the Node backend on Render.
3. Point the frontend at the Render API URL.
4. Allow the Vercel domain in backend CORS.

### 1. Deploy the backend to Render

1. Push this project to GitHub.
2. In Render, create a new Web Service from the repo.
3. Set the Root Directory to `backend`.
4. Use these settings:

```env
MYSQL_HOST=...
MYSQL_PORT=3306
MYSQL_USER=...
MYSQL_PASSWORD=...
MYSQL_DATABASE=habit_tracker
FRONTEND_ORIGIN=https://your-vercel-app.vercel.app
PORT=10000
```

5. Render can run the app with `npm start`.
6. After deploy, note your backend URL, for example `https://habit-tracker-api.onrender.com`.

### 2. Provide MySQL for Render

This app uses MySQL, not Postgres.

If you want to keep everything on Render, deploy MySQL there as a separate private service and connect your backend web service to it. Render’s current docs describe MySQL deployment as a Docker-based private service with a persistent disk and an internal address such as `mysql:3306`.

If you already have a MySQL provider elsewhere, you can use that instead and set the same `MYSQL_*` variables in Render.

### 3. Point the Vercel frontend at Render

The frontend reads the API base URL from this tag in [frontend/index.html](/C:/Users/iamth/OneDrive/Desktop/HabitTracker/frontend/index.html):

```html
<meta name="api-base-url" content="">
```

Before deploying the frontend, change it to your Render backend URL:

```html
<meta name="api-base-url" content="https://habit-tracker-api.onrender.com">
```

The app will then call `https://habit-tracker-api.onrender.com/api/state`.

### 4. Deploy the frontend to Vercel

1. Import the same repo into Vercel.
2. Set the Root Directory to `frontend`.
3. Set the project as a static site.
4. Because the app is plain HTML, no build command is required.
5. Deploy after updating the `api-base-url` meta tag.

### 5. Verify the deployment

1. Open the Render health endpoint at `/health`.
2. Open the Vercel app.
3. Create or edit a habit.
4. Refresh the page and confirm data persists.

## Docker deployment

The backend includes [backend/Dockerfile](/C:/Users/iamth/OneDrive/Desktop/HabitTracker/backend/Dockerfile), so you can also deploy it on any platform that supports Docker:

```bash
cd backend
docker build -t habit-tracker .
docker run --env-file .env -p 3000:3000 habit-tracker
```

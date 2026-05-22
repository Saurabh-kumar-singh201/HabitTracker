# Habit Tracker

Simple Habit Tracker app split into:

- `frontend/` for the Vercel static site
- `backend/` for the Render Express API backed by MongoDB

## Run locally

1. Install backend dependencies:

```bash
cd backend
npm install
```

2. Create `backend/.env` and set your MongoDB connection values.

3. Start the backend:

```bash
cd backend
npm start
```

4. Open [frontend/index.html](/C:/Users/iamth/OneDrive/Desktop/HabitTracker/frontend/index.html) in a browser, or serve the `frontend/` folder with any static server.

The API will be available at `http://localhost:3000`.

## Environment variables

Required for persistence:

- `MONGODB_URI`

Optional:

- `MONGODB_DATABASE`
- `MONGODB_COLLECTION`
- `FRONTEND_ORIGIN`
- `PORT`

If MongoDB is not configured, the UI can still load, but API persistence will not work.

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
MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>/<dbname>?retryWrites=true&w=majority
MONGODB_DATABASE=habit_tracker
MONGODB_COLLECTION=app_state
FRONTEND_ORIGIN=https://your-vercel-app.vercel.app
PORT=10000
```

5. Render can run the app with `npm start`.
6. After deploy, note your backend URL, for example `https://habit-tracker-api.onrender.com`.

### 2. Provide MongoDB for Render

This app now uses MongoDB for persistence.

The easiest option is MongoDB Atlas. Create a free cluster, create a database user, allow access from your backend, then copy the connection string into `MONGODB_URI`.

If you already have another MongoDB provider, use that connection string instead and set the same `MONGODB_*` variables in Render.

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

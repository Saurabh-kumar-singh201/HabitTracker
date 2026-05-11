# Habit Tracker

Simple Habit Tracker app served by Express with state stored in MySQL.

## Run locally

1. Install dependencies:

```bash
npm install
```

2. Create `.env` from `.env.example` and set your MySQL credentials.

3. Start the app:

```bash
npm start
```

The app will be available at `http://localhost:3000`.

## Environment variables

Required for persistence:

- `MYSQL_HOST`
- `MYSQL_PORT`
- `MYSQL_USER`
- `MYSQL_PASSWORD`
- `MYSQL_DATABASE`

Optional:

- `PORT`

If MySQL is not configured, the UI can still load, but API persistence will not work.

## Recommended deployment

The easiest path for this project is:

1. Push the code to GitHub.
2. Deploy the Node app to Railway or Render.
3. Attach a MySQL database and set the environment variables from `.env.example`.

Because the frontend uses relative API calls like `/api/state`, no frontend API URL changes are needed when the app and server are deployed together.

## Railway deployment

1. Create a new GitHub repository and push this project.
2. In Railway, create a new project from the GitHub repo.
3. Add a MySQL database service.
4. Add these variables to the web service:

```env
MYSQL_HOST=...
MYSQL_PORT=3306
MYSQL_USER=...
MYSQL_PASSWORD=...
MYSQL_DATABASE=habit_tracker
PORT=3000
```

5. Railway should detect the Node app automatically and run `npm start`.

## Docker deployment

This repo includes a `Dockerfile`, so you can also deploy it on any platform that supports Docker:

```bash
docker build -t habit-tracker .
docker run --env-file .env -p 3000:3000 habit-tracker
```

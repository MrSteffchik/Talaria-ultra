# Use a lightweight official Python image
FROM python:3.11-slim

# Set the working directory in the container
WORKDIR /app

# Prevent Python from writing .pyc files to disk
ENV PYTHONDONTWRITEBYTECODE=1

# Prevent Python from buffering stdout/stderr (useful for getting real-time logs in Railway)
ENV PYTHONUNBUFFERED=1

# Copy requirements file first to take advantage of Docker cache
COPY bot/requirements.txt /app/bot/

# Install dependencies
RUN pip install --no-cache-dir -r bot/requirements.txt

# Copy the rest of the bot application code
COPY bot/ /app/bot/

# Set the default command to run the Telegram bot
CMD ["python", "bot/main.py"]

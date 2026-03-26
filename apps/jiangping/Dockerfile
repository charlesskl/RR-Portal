FROM python:3.12-slim

WORKDIR /app

# Only curl needed as system dependency
# opencv-python-headless eliminates the need for libgl1/mesa/llvm
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Install CPU-only PyTorch first (much smaller than full torch)
RUN pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cpu

# Install headless OpenCV before easyocr to avoid pulling in full opencv-python
RUN pip install --no-cache-dir opencv-python-headless

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt gunicorn

COPY . .

# Ensure data and uploads directories exist
RUN mkdir -p /app/data /app/uploads

EXPOSE 5001

CMD ["gunicorn", "--bind", "0.0.0.0:5001", "--workers", "2", "--timeout", "120", "wsgi:app"]

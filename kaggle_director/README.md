# Qwen3.8-27B Kaggle Director

This directory contains the Kaggle Notebook and the Python backend services for the AETHER AI Director, utilizing `Qwen/Qwen3.8-27B`.

## Files
- `Kaggle_Director_Qwen.ipynb`: The standalone Jupyter notebook to upload to Kaggle.
- `requirements.txt`: Python package dependencies.
- `director/`: The microservice modules (FastAPI, inference logic, Pydantic JSON schemas, and caching).

## Instructions
1. Zip this directory or upload `Kaggle_Director_Qwen.ipynb` directly to Kaggle.
2. Select **GPU T4 x2** as the accelerator.
3. Configure `NGROK_AUTHTOKEN` in Kaggle Secrets.
4. Run all cells sequentially. The notebook will automatically test memory, inference, and AETHER schema compatibility before starting the external ngrok API.

# ECG Analysis in the Cloud Using AWS

Educational full-stack starter project:
- React + Vite frontend
- Flask REST API
- CSV ECG signal upload and waveform preview
- Basic signal summary and optional R-peak/heart-rate estimate using SciPy
- Optional AWS S3 file storage and DynamoDB metadata storage
- Local mode works without AWS credentials

> Medical safety: this is an educational signal-processing demo, not a diagnostic tool. Do not use it to diagnose, triage, or treat patients. Use de-identified/synthetic data only unless you have appropriate consent, security, and governance.

## Requirements
- Python 3.10+
- Node.js 18+
- An AWS account only if you want cloud storage

## 1. Run the backend locally
```bash
cd backend
python -m venv .venv
# Windows:
.venv\Scripts\activate
# macOS/Linux:
# source .venv/bin/activate
pip install -r requirements.txt
copy .env.example .env
python app.py
```
Backend: http://127.0.0.1:5000

The API expects a CSV file with one numeric ECG column, or a column named `ecg`. If your CSV has a time column, it is ignored when selecting the ECG column.

## 2. Run the frontend locally
Open another terminal:
```bash
cd frontend
npm install
copy .env.example .env
npm run dev
```
Open the local URL printed by Vite (normally http://localhost:5173).

## 3. Enable AWS storage
Create an S3 bucket and a DynamoDB table in the same AWS region. DynamoDB table:
- Table name: `ecg-analysis-results`
- Partition key: `analysis_id` (String)

Configure `backend/.env`:
```env
AWS_ENABLED=true
AWS_REGION=ap-south-1
S3_BUCKET=your-unique-private-bucket-name
DYNAMODB_TABLE=ecg-analysis-results
```
Do not put AWS access keys in `.env` for deployment. Locally, configure credentials with the AWS CLI (`aws configure`) or another supported credential provider. On EC2, attach an IAM instance role with least-privilege S3 and DynamoDB permissions.

The S3 bucket should remain private. Enable block-public-access, encryption, and appropriate lifecycle/retention rules. For real ECG data, use appropriate consent, security review, and regulatory/privacy controls.

## API
- `GET /api/health` — health check
- `POST /api/analyze` — multipart upload field `file`; optional `sampling_rate_hz` form field
- `GET /api/history` — recent metadata records (AWS mode only; local mode returns an empty list)

## Deploying to AWS (overview)
1. Deploy Flask API to an EC2 instance behind HTTPS (prefer a load balancer or a managed HTTPS reverse proxy).
2. Set the API URL in `frontend/.env.production` as `VITE_API_URL=https://your-api-domain.example`.
3. Build the React frontend with `npm run build`.
4. Host the `frontend/dist` files using AWS Amplify Hosting, or S3 behind CloudFront with Origin Access Control.
5. Configure backend CORS to allow only your deployed frontend origin.
6. Attach an EC2 IAM role for S3 and DynamoDB; never commit credentials.
7. Test upload, analysis, history, error cases, and permissions before presenting the project.

AWS docs:
- S3 static website/hosting: https://docs.aws.amazon.com/AmazonS3/latest/userguide/WebsiteHosting.html
- CloudFront secure S3 origin: https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/GettingStarted.SimpleDistribution.html
- Boto3 credentials: https://boto3.amazonaws.com/v1/documentation/api/latest/guide/credentials.html

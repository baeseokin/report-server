#!/bin/bash

# 사용법: ./deploy-k8s-server.sh <VERSION>
# 예시: ./deploy-k8s-server.sh 0.1

# 1. 버전 파라미터 확인
if [ -z "$1" ]; then
  echo "❌ 사용법: $0 <VERSION>"
  exit 1
fi

VERSION=$1
IMAGE_NAME="baeseokin/report-server"

echo "🚀 report-server 배포 시작 (버전: $VERSION)..."

# 2. Docker 이미지 빌드
echo "📦 이미지 빌드 중..."
docker build -t $IMAGE_NAME:$VERSION .

if [ $? -ne 0 ]; then
  echo "❌ 이미지 빌드 실패!"
  exit 1
fi

# 3. Docker Hub에 푸시
echo "📤 Docker Hub로 푸시 중..."
docker push $IMAGE_NAME:$VERSION

if [ $? -ne 0 ]; then
  echo "❌ Docker Hub 푸시 실패!"
  exit 1
fi

# 4. Kubernetes Deployment 업데이트
echo "📡 Kubernetes 배포 업데이트..."
kubectl set image deployment/report-server report-server=$IMAGE_NAME:$VERSION

# 5. 롤아웃 확인
kubectl rollout status deployment/report-server  -n tomcat-test

echo "✅ report-server 배포 완료!"

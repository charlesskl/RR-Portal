FROM node:20-alpine AS frontend-build
WORKDIR /src/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
ARG VITE_BASE_PATH=/stitch-cost/
ENV VITE_BASE_PATH=${VITE_BASE_PATH}
RUN npm run build

FROM mcr.microsoft.com/dotnet/sdk:8.0 AS backend-build
WORKDIR /src
COPY backend/StitchCostPro.Api/StitchCostPro.Api.csproj backend/StitchCostPro.Api/
RUN dotnet restore backend/StitchCostPro.Api/StitchCostPro.Api.csproj
COPY backend/ backend/
RUN dotnet publish backend/StitchCostPro.Api/StitchCostPro.Api.csproj \
    --configuration Release \
    --output /app/publish \
    --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:8.0
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*
RUN useradd --create-home --uid 10001 appuser
WORKDIR /app
COPY --from=backend-build /app/publish ./
COPY --from=frontend-build /src/frontend/dist ./wwwroot
RUN chown -R appuser:appuser /app
USER appuser
ENV ASPNETCORE_URLS=http://+:5192
EXPOSE 5192
HEALTHCHECK --interval=10s --timeout=5s --retries=3 --start-period=20s \
  CMD curl --fail --silent http://localhost:5192/api/health || exit 1
ENTRYPOINT ["dotnet", "StitchCostPro.Api.dll"]

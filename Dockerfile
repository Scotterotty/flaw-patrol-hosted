# Local trial image: runs the app in development mode so the email-only
# developer login works. Not for production hosting.
FROM node:22
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
EXPOSE 3000
CMD ["sh", "-c", "npx prisma migrate deploy && if [ \"$SEED_DEMO\" = \"true\" ]; then npm run db:seed; fi && npx next dev -H 0.0.0.0 -p 3000"]

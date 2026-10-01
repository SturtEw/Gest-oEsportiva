# Frontend (Vite) em container.
#
# Autorizado pelo prompt de infraestrutura: strictPort false permite que o Vite
# caia para 5174/5175 quando a 5173 estiver ocupada, e o compose mapeia um RANGE
# de portas para que a porta dinamica escolhida dentro do container continue
# acessivel pelo host e pelo debugger.
#
# O host e "0.0.0.0" porque o Vite escuta em todas as interfaces dentro do
# container; o mapeamento do compose e que decide o que o host enxerga.
FROM node:22-alpine

WORKDIR /app

# Dependencias em camada propria: rebuild so do codigo quando o package muda.
COPY package.json package-lock.json* ./
RUN npm ci || npm install

COPY . .

EXPOSE 5173-5185

CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]

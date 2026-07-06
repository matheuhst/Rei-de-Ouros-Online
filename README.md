# Concurso de Beleza Online

Versão online do jogo, com salas em tempo real usando **Node.js + Express + Socket.IO**.

## Como rodar no seu PC

1. Instale o Node.js 18 ou superior.
2. Extraia este ZIP.
3. Abra o terminal dentro da pasta `concurso-beleza-online`.
4. Rode:

```bash
npm install
npm start
```

5. Abra no navegador:

```text
http://localhost:3000
```

## Como testar com duas pessoas no mesmo PC

1. Abra `http://localhost:3000` em uma aba.
2. Digite seu nome e clique em **Criar sala**.
3. Copie o código da sala.
4. Abra outra aba ou janela anônima.
5. Digite outro nome, coloque o código e clique em **Entrar na sala**.
6. Na primeira aba, clique em **Iniciar partida**.

## Como jogar online pelo Render

Este projeto precisa ser publicado como **Web Service**, não como Static Site, porque usa servidor Node.js e WebSocket.

Configuração recomendada no Render:

```text
Build Command: npm install
Start Command: npm start
```

O servidor usa automaticamente a porta do Render com:

```js
process.env.PORT
```

## Estrutura

```text
concurso-beleza-online/
├─ public/
│  ├─ index.html
│  ├─ style.css
│  └─ scripts.js
├─ server.js
├─ package.json
├─ render.yaml
└─ README.md
```

## Observação importante

As salas ficam salvas em memória. Se o serviço reiniciar, as salas ativas somem. Para uso profissional, o próximo passo seria salvar estado em Redis ou banco de dados.

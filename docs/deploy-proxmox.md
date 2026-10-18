# Deploy no Proxmox com Cloudflare Tunnel

Stack independente de produção: `compose.production.yml`. Não combine com o Compose local.
Fluxo: Cloudflare → cloudflared → Nginx → web/API → MongoDB. O worker usa o mesmo banco.
Não há portas publicadas na VM, nem necessidade de encaminhar portas no roteador ou usar Caddy.
O HTTPS público termina na Cloudflare; o túnel até a VM é criptografado.

## 1. Preparar a VM

Crie uma VM Debian/Ubuntu Server LTS no Proxmox. Ponto inicial para uso pequeno: 4 vCPU,
8 GB RAM e 40 GB em SSD, ampliando conforme os dados. Use CPU `host` em servidor único
(MongoDB exige AVX em x86-64); para migração entre hosts, selecione CPU compatível com todos.
Habilite inicialização automática da VM e o QEMU Guest Agent.
Instale Git, OpenSSL e Docker Engine com Compose v2 seguindo a documentação oficial:
https://docs.docker.com/engine/install/. Habilite o serviço Docker na inicialização.
Libere saída para Cloudflare Tunnel (porta 7844 TCP/UDP), DNS, HTTPS e seu SMTP.
Mantenha acesso SSH administrativo pela rede privada/VPN.

Clone o repositório na VM e entre na raiz. Os comandos abaixo partem dessa pasta.

## 2. Configurar segredos e domínio

```bash
umask 077
cp .env.production.example .env.production
mkdir -p infra/production/secrets
openssl rand -base64 756 > infra/production/secrets/mongo-keyfile
# Gere duas senhas diferentes e coloque nos campos MONGO_*_PASSWORD do .env.production:
openssl rand -hex 32
openssl rand -hex 32
```

Edite `.env.production`:

- `PUBLIC_APP_URL`: origem HTTPS real, por exemplo `https://zelo.seudominio.com`.
- `MONGO_ROOT_PASSWORD` e `MONGO_APP_PASSWORD`: senhas hexadecimais geradas acima.
- `SMTP_URL` e `MAIL_FROM`: credenciais de envio reais. Faça URL-encoding de caracteres
  especiais no usuário/senha da URL SMTP. Use aspas simples em valores contendo `$`.
- `VAPID_*`: chaves persistentes; trocar as chaves invalida inscrições Web Push existentes.
- `RELEASE_TAG`: identificador único da versão, por exemplo o SHA do commit.
- Imagens de infraestrutura: os padrões estão no exemplo; fixe tags/digests testados para
  releases reproduzíveis. Não atualize a versão principal do MongoDB sem seu procedimento de upgrade.

É possível gerar VAPID na VM usando a imagem da API, sem instalar Node no host:

```bash
docker build -t zelo-api:setup -f apps/api/Dockerfile .
docker run --rm --entrypoint node zelo-api:setup -e \
  'console.log(JSON.stringify(require("/app/apps/api/node_modules/web-push").generateVAPIDKeys(), null, 2))'
```

Copie `publicKey`/`privateKey` para o arquivo e ajuste `VAPID_SUBJECT=mailto:seu-email`.

## 3. Criar o Cloudflare Tunnel

No painel Cloudflare, crie um túnel gerenciado remotamente do tipo **cloudflared**.
Copie somente o token mostrado no comando de instalação para o arquivo
`infra/production/secrets/tunnel-token` (uma linha, sem aspas). Não execute aquele comando:
o Compose já inicia o conector. O token permite executar o túnel, então guarde-o como segredo.

Adicione uma rota pública (Published application / Public hostname) no túnel:

| Campo | Valor |
|---|---|
| Hostname | `zelo.seudominio.com` |
| Service type | HTTP |
| URL | `proxy:80` |

Essa URL funciona dentro da rede Docker do conector desta stack. Se já existe um conector em
outro lugar, crie um túnel dedicado: réplicas externas não conseguem resolver `proxy`.
Não crie registro A apontando para o IP privado da VM; use o registro associado ao túnel.

Crie uma Cache Rule para `http.host eq "zelo.seudominio.com"` com **Bypass cache**,
com prioridade sobre regras existentes de cache. Isso evita cache compartilhado de conteúdo
pessoal e do service worker. O cache offline local do PWA continua funcionando.
Habilite **Always Use HTTPS** para redirecionar o acesso público HTTP.

Não coloque desafios interativos ou Cloudflare Access na rota de importação do Health Auto Export:
o cliente usa Bearer token e não consegue completar login/desafio de navegador. Se houver
políticas globais, ajuste-as para esse endpoint sem remover a autenticação da aplicação.

Referências: [configurar túnel](https://developers.cloudflare.com/tunnel/get-started/),
[token](https://developers.cloudflare.com/tunnel/reference/tunnel-tokens/),
[cache](https://developers.cloudflare.com/cache/how-to/cache-rules/create-dashboard/).

## 4. Primeiro deploy

```bash
chmod 700 infra/production/secrets
chmod 600 .env.production infra/production/secrets/mongo-keyfile
# cloudflared roda sem root e precisa ler o arquivo montado como secret:
chmod 644 infra/production/secrets/tunnel-token
docker compose --env-file .env.production -f compose.production.yml config --quiet
docker compose --env-file .env.production -f compose.production.yml build
docker compose --env-file .env.production -f compose.production.yml up -d --wait --wait-timeout 300
docker compose --env-file .env.production -f compose.production.yml ps -a
```

`mongo-init` cria um usuário limitado ao banco `zelo`; `migrate` executa índices/migrações.
Ambos devem terminar com código 0. Os demais serviços permanecem em execução.
A chave interna do replica set é copiada para um arquivo com permissões exigidas pelo MongoDB.
Os volumes de produção usam o projeto `zelo-production`, separados do ambiente local.

Confira `https://seu-dominio/api/v1/health`, cadastro/login, envio de recuperação de senha,
instalação do PWA, inscrição push e importação pelo iPhone. Nos logs da API, confira que o
rate limit distingue visitantes: Nginx substitui X-Forwarded-For pelo CF-Connecting-IP.
Não publique a porta do proxy diretamente: essa confiança depende do acesso via cloudflared.

Diagnóstico:

```bash
docker compose --env-file .env.production -f compose.production.yml logs --tail=100 mongo mongo-init migrate api worker proxy cloudflared
```

## 5. Atualizar (com breve indisponibilidade)

Faça backup, atualize o checkout e coloque um novo `RELEASE_TAG` no `.env.production`.
Construa antes de parar os serviços; falhas de build não derrubam a versão atual.

```bash
bash infra/production/backup.sh
docker compose --env-file .env.production -f compose.production.yml build
docker compose --env-file .env.production -f compose.production.yml down
docker compose --env-file .env.production -f compose.production.yml up -d --wait --wait-timeout 300
```

`down` preserva os volumes; **não use `down -v`**. A recriação garante que init e migrações
executem novamente antes da API. Nunca rode dois workers de releases diferentes sobre o banco
na atualização. Se houver falha, consulte os logs; não publique até resolver.

Para rollback do código, volte ao commit e ao `RELEASE_TAG` anterior e suba sem `--build`;
as imagens locais anteriores devem estar preservadas. Não faça prune delas até validar a release.
Rollback do código depende da compatibilidade das migrações; restauração do banco pode ser necessária.
Alterar senhas no `.env.production` não altera usuários existentes: rotacione no MongoDB também,
com os serviços da aplicação parados. O bootstrap falha se a senha da aplicação não confere.

## 6. Backup e recuperação

```bash
bash infra/production/backup.sh
```

O script produz um dump completo com oplog, incluindo usuários, para restauração consistente
em outro replica set. Em falhas de dump, não publica um arquivo final incompleto.
Agende diariamente e copie os arquivos criptografados para armazenamento fora do servidor.
Defina retenção no destino; o script não apaga backups antigos. Guarde também `.env.production`,
chaves VAPID e os arquivos em `infra/production/secrets` em um cofre seguro.
Snapshots/backups da VM complementam esse dump e devem incluir o disco de dados.

Teste periodicamente a recuperação em **uma VM isolada**, com o mesmo MongoDB e replica set,
sem iniciar cloudflared, API ou worker. Copie o arquivo e use `mongorestore --archive --gzip
--oplogReplay --drop`, com autenticação administrativa, lendo o arquivo pela entrada padrão.
O dump contém o banco admin e pode substituir as credenciais pelas da origem; preserve essas
credenciais no cofre. Nunca execute essa restauração sobre o banco ativo sem uma janela de
recuperação planejada. Valide os dados restaurados e a aplicação antes de conectar o túnel.

Este deploy usa um replica set de um nó para suportar transações; não oferece alta disponibilidade.

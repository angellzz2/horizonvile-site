# HorizonVille Site V2

Versão completa da base visual do site da HorizonVille com página principal e loja separadas, carrinho, cupom promocional, métodos de pagamento no checkout, painel administrativo de cupons e API preparada para comunicação com MTA.

## Rodar no computador

1. Instale Node.js 18 ou superior.
2. Abra a pasta no terminal.
3. Defina as variáveis de ambiente do arquivo `.env.example` no seu sistema/hospedagem.
4. Execute `node server.js`.
5. Abra `http://localhost:3000`.

Sem variáveis configuradas, a senha admin padrão é `troque-esta-senha`. Troque isso antes de publicar.

## Hospedar no Render

Crie um Web Service apontando para este projeto e use `node server.js` como Start Command. Configure `ADMIN_PASSWORD`, `ADMIN_TOKEN_SECRET`, `MTA_API_KEY` e `PAYMENT_MODE` nas Environment Variables.

## Carrinho e cupons

O carrinho fica salvo no navegador do jogador. Os cupons ficam no arquivo `data/store.json` e são criados/controlados pelo painel `/admin.html`.

## Pagamentos

O checkout oferece PIX, cartão e boleto. Por padrão `PAYMENT_MODE=demo`, então nenhum valor real é cobrado. O backend já cria pedidos e calcula os cupons corretamente. Para aceitar dinheiro real, é necessário conectar uma conta de um provedor de pagamento e implementar a confirmação por webhook antes de marcar o pagamento como aprovado.

## Integração com MTA

A pasta `mta/hv_store` contém um resource inicial. Ajuste `apiUrl`, `apiKey` e os nomes dos grupos ACL em `config.lua`. O resource busca compras aprovadas, adiciona o jogador ao grupo VIP configurado, mostra uma mensagem no chat e confirma a entrega na API.

Para produtos que não sejam VIP via ACL, adapte a função `grantItem` em `mta/hv_store/server.lua` ao sistema de veículos/extras do seu servidor.

## Produção

O armazenamento atual usa JSON para ser simples de editar e testar. Em uma hospedagem sem disco persistente, os dados podem ser perdidos após reinício. Para uma loja real, migre `data/store.json` para PostgreSQL/MySQL ou use um disco persistente.

## Atualização V3
- Loja separada por categorias: VIPs, Carros, Gemas e Outros.
- Painel Admin > Produtos permite adicionar, editar, pausar/ativar e excluir itens.
- Painel Admin > Cupons controla percentual, validade e limite de uso.
- Rotas amigáveis: `/admin`, `/loja` e `/carrinho`.
- Fundo animado com grid, feixes, partículas e elementos tecnológicos.


## Novidades V4
- Home mais animada (radar, grid holográfico, faíscas, varredura e entrada por rolagem).
- Removido o item “Diferenciais” do menu, mantendo o conteúdo da seção.
- Painel com faturamento, lucro estimado e número de vendas aprovadas.
- Produtos podem ser exclusivos, ter bônus, ser limitados com estoque e ter custo unitário.
- Upload de imagem do dispositivo diretamente pelo painel admin (até 5 MB).
- Produtos limitados exibem estoque e são impedidos de vender quando esgotados.

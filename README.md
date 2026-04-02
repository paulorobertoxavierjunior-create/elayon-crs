# ELAYON CRS

Interface pública do sistema de análise temporal da fala.

## Estrutura

- Frontend: GitHub Pages
- Backend: CRS Cloud (Flask)
- Integração: via API REST

## Funcionamento

1. Usuário envia contexto + fala
2. Front envia para CRS cloud
3. CRS processa
4. Retorna JSON + relatório

## Segurança

- Nenhuma lógica do CRS está no front
- Apenas comunicação via API

## Status

Versão: Cloud Ready
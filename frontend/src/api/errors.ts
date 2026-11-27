import { isApiError } from './client'

/** How each API input field is called on screen, for error sentences. */
const FIELD_LABELS: Record<string, string> = {
  scientific_name: 'O nome científico',
  common_name: 'O nome comum',
  notes: 'As notas',
  name: 'O nome',
  photo: 'A fotografia',
  calibration_line: 'A linha da escala',
  calibration_length_m: 'A distância',
  default_water_interval_days: 'O intervalo de rega',
  performed_on: 'O dia',
  zones: 'Zonas:',
  species: 'Espécies:',
  title: 'O título',
  zone_id: 'O sítio',
  plot_id: 'A parcela',
  kind: 'O tipo',
  status: 'O estado',
  due_on: 'O prazo',
  description: 'Os pormenores',
  label: 'O nome',
  geom: 'O contorno',
  alignment: 'Os pontos de referência',
  captured_on: 'O dia da fotografia',
}

function sentence(s: string): string {
  const t = s.trim()
  return t.endsWith('.') ? t : `${t}.`
}

/** A sentence a person in the field can act on, for any error thrown by the API layer. */
export function friendlyError(err: unknown): string {
  if (!isApiError(err)) return 'Algo correu mal. Tenta outra vez.'
  switch (err.code) {
    case 'network':
      return 'Sem ligação ao servidor. Vê se tens rede e tenta outra vez.'
    case 'timeout':
      return 'O servidor está a demorar demasiado. Tenta daqui a pouco.'
    case 'duplicate':
      return err.field && FIELD_LABELS[err.field]
        ? `${FIELD_LABELS[err.field]} já está a ser usado noutro registo.`
        : 'Esse nome já existe.'
    case 'field_exists':
      return 'Este terreno já está configurado.'
    case 'no_field':
      return 'Configura primeiro o terreno (Configurar o terreno).'
    case 'not_an_image':
      return 'Esse ficheiro não é uma fotografia que a aplicação consiga ler. Usa uma imagem PNG, JPG ou WebP.'
    case 'too_large':
      return err.status === 413
        ? 'A fotografia é grande demais para enviar (máximo 30 MB).'
        : 'A fotografia tem píxeis a mais (máximo 12 000 por lado, 40 megapíxeis). Reduz primeiro o tamanho.'
    case 'invalid': {
      const label = err.field ? FIELD_LABELS[err.field] : undefined
      if (label && err.message) return sentence(`${label} ${err.message}`)
      return err.message ? sentence(`Verifica isto: ${err.message}`) : 'Verifica o que escreveste.'
    }
    case 'deleted':
      return 'Isto foi apagado entretanto.'
    case 'not_found':
      return 'Isto já não existe.'
    case 'version_conflict':
      return 'Isto foi alterado noutro sítio entretanto. Recarrega para veres a versão mais recente.'
    default:
      return err.requestId
        ? `O servidor teve um problema (ref. ${err.requestId}). Tenta outra vez.`
        : 'O servidor teve um problema. Tenta outra vez.'
  }
}

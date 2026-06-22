import { Injectable } from '@angular/core';

const NVIDIA_API_KEY = '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';
const API_URL        = '/nvidia-api/v1/chat/completions';
const MODEL          = 'z-ai/glm-5.1';
const PDF_SERVER     = 'http://localhost:8765';

const PROMPT_APELACION = `Sos un abogado experto en derecho laboral argentino especializado en accidentes de trabajo (Ley 24.557, Ley 26.773) y procedimientos ante la SRT (Superintendencia de Riesgos del Trabajo).

Analizá el siguiente texto de un expediente SRT y determiná si existe base jurídica para apelar o accionar judicialmente. Buscá específicamente:
1. Dictamen de incapacidad: ¿el porcentaje es bajo o cuestionable? ¿hay patologías no consideradas?
2. Plazos: ¿hay vencimientos de pronto despacho o plazos procesales?
3. Errores procedimentales: ¿notificaciones deficientes, resoluciones sin fundamentar?
4. Cobertura: ¿contingencias rechazadas injustificadamente?
5. Cálculo de indemnización: ¿el IBM o el RIPTE fueron correctamente aplicados?

Respondé de forma concisa y estructurada:
**VEREDICTO**: APELAR / NO APELAR / ANALIZAR MÁS
**FUNDAMENTOS**: [máximo 3 puntos clave]
**ACCIÓN RECOMENDADA**: [qué hacer concretamente]

TEXTO DEL EXPEDIENTE:
`;

@Injectable({ providedIn: 'root' })
export class NvidiaIaService {

  /** Extrae el texto del PDF desde el servidor local */
  async extraerTextoPdf(nroExpediente: string): Promise<string> {
    const archivo = 'expediente_' + nroExpediente.trim().replace('/', '_') + '.pdf';
    const resp = await fetch(`${PDF_SERVER}/texto/${archivo}`);
    if (!resp.ok) throw new Error(`PDF no encontrado: ${archivo}`);
    const data = await resp.json();
    if (data.error) throw new Error(data.error);
    return (data.texto as string) ?? '';
  }

  /** Analiza el expediente con NVIDIA IA usando streaming. Retorna AsyncGenerator de chunks. */
  async *analizarExpediente(textoPdf: string): AsyncGenerator<string> {
    const prompt = PROMPT_APELACION + textoPdf.slice(0, 12000); // max ~12k chars

    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${NVIDIA_API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 800,
        stream: true,
      }),
    });

    if (!res.ok) throw new Error(`NVIDIA API error ${res.status}: ${await res.text()}`);
    if (!res.body) throw new Error('Sin respuesta del modelo');

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer    = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') return;
        try {
          const p = JSON.parse(data) as { choices: { delta: { content?: string | null } }[] };
          const c = p.choices[0]?.delta?.content;
          if (c) yield c;
        } catch { /* skip malformed chunk */ }
      }
    }
  }
}

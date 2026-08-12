interface EmailLayoutOptions {
  heading: string;
  message: string;
  ctaLabel: string;
  ctaUrl: string;
  footnote?: string;
}

// Estilo inline (sem <style>/classes) de propósito: é o que sobrevive de
// forma confiável nos clientes de e-mail (Outlook, Gmail, etc.).
export function buildEmailHtml({
  heading,
  message,
  ctaLabel,
  ctaUrl,
  footnote,
}: EmailLayoutOptions): string {
  return `
<div style="background-color:#f4f6f8;padding:32px 16px;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">
  <div style="max-width:480px;margin:0 auto;background-color:#ffffff;border-radius:12px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
    <p style="margin:0 0 8px;font-size:13px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:#38B6FF;">Auth System</p>
    <h1 style="margin:0 0 16px;font-size:20px;color:#0f172a;">${heading}</h1>
    <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#334155;">${message}</p>
    <p style="margin:0 0 24px;">
      <a href="${ctaUrl}" style="display:inline-block;padding:12px 28px;background-color:#38B6FF;color:#04101f;font-weight:600;font-size:15px;border-radius:8px;text-decoration:none;">${ctaLabel}</a>
    </p>
    <p style="margin:0;font-size:13px;color:#94a3b8;word-break:break-all;">Se o botão não funcionar, copie e cole este link no navegador:<br /><a href="${ctaUrl}" style="color:#38B6FF;">${ctaUrl}</a></p>
    ${footnote ? `<p style="margin:24px 0 0;font-size:13px;color:#94a3b8;">${footnote}</p>` : ''}
  </div>
</div>`.trim();
}

/**
 * Contas de e-mail da Ana usadas em toda a LUCK (acesso, agenda, reuniões, Jira, CRM).
 */
export const ANGI_EMAIL = "ana@angisaude.com";
export const DEVORE_EMAIL = "ana@devoresnacks.com";
export const PESSOAL_EMAIL = "anaduquek@gmail.com";
export const EXTRA_EMAILS = ["drabiazinha@gmail.com", "biduque@hotmail.com"];

/** E-mails que entram automaticamente como membros ativos. */
export const ALLOWED_EMAILS = [
  DEVORE_EMAIL,
  PESSOAL_EMAIL,
  ANGI_EMAIL,
  "drabiazinha@gmail.com",
];

/** Todos os e-mails da Ana — usados para cruzar convites/reuniões/links de Meet. */
export const MY_EMAILS = [
  ANGI_EMAIL,
  DEVORE_EMAIL,
  PESSOAL_EMAIL,
  ...EXTRA_EMAILS,
];

export function isMyEmail(email?: string | null) {
  if (!email) return false;
  return MY_EMAILS.includes(email.toLowerCase().trim());
}

/** true quando o e-mail/domínio pertence à Angi. */
export function isAngiEmail(email?: string | null) {
  if (!email) return false;
  return email.toLowerCase().includes("angisaude.com");
}

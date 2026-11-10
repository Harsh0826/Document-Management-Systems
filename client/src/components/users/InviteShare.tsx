import { Check, Copy, Link2, Mail } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/form-controls';
import { APP_NAME } from '@/lib/utils';

/**
 * Shows a ready-to-send message containing a single-use invitation or password-reset link, with
 * one-click copy and "open in email". Nothing is sent by the app itself.
 */
export function InviteShare({
  url,
  hours,
  firstName,
  email,
  kind = 'invite',
}: {
  url: string;
  hours: number | null;
  firstName: string;
  email: string;
  kind?: 'invite' | 'reset';
}) {
  const validity = hours ? ` The link works once and expires in ${hours >= 48 ? `${Math.round(hours / 24)} days` : `${hours} hours`}.` : '';
  const initial =
    kind === 'invite'
      ? `Hi ${firstName},\n\nYou now have access to ${APP_NAME}, where you can view and download your documents and certificates.\n\nOpen this link to choose your password:\n${url}\n\n${validity.trim()}\n\nThanks`
      : `Hi ${firstName},\n\nHere is your link to set a new ${APP_NAME} password:\n${url}\n\n${validity.trim()}\n\nThanks`;
  const [message, setMessage] = useState(initial);
  const [copied, setCopied] = useState<'msg' | 'link' | null>(null);
  const subject = kind === 'invite' ? `Your ${APP_NAME} access` : `Reset your ${APP_NAME} password`;

  const copy = async (what: 'msg' | 'link') => {
    await navigator.clipboard.writeText(what === 'msg' ? message : url);
    setCopied(what);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
        <Link2 className="mt-0.5 size-4 shrink-0" />
        <span>
          Send this message to <b>{email}</b>. {kind === 'invite' ? 'They will choose their own password.' : 'They will choose a new password.'}
        </span>
      </div>
      <Textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={9} className="text-sm" aria-label="Message to send" />
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => copy('msg')}>
          {copied === 'msg' ? <Check /> : <Copy />} {copied === 'msg' ? 'Message copied' : 'Copy message'}
        </Button>
        <Button variant="outline" asChild>
          <a href={`mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`}>
            <Mail /> Open in email
          </a>
        </Button>
        <Button variant="ghost" onClick={() => copy('link')}>
          {copied === 'link' ? <Check /> : <Link2 />} {copied === 'link' ? 'Link copied' : 'Copy link only'}
        </Button>
      </div>
    </div>
  );
}

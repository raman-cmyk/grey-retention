"""Step 0 block renderer: brand kit + block list (JSON) -> email-safe HTML.

Email-safe: tables, inline styles, 600px wide, single column on mobile,
web-safe font stack, no JS, no background images. Text is live HTML
(VISION rule 10). The footer carries Klaviyo's required tags.
Usage: python3 render.py spec.json out.html
"""
import html, json, sys

def esc(s):
    return html.escape(s or "", quote=True)

def render(spec):
    k = spec["brand"]
    font = f"{k['font']}, Arial, Helvetica, sans-serif"
    ink, bg, accent, dark = k["ink"], k["background"], k["accent"], k["dark"]
    radius = k.get("radius", "8px")

    def btn(label, url, color=accent):
        return (f'<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center"><tr>'
                f'<td bgcolor="{color}" style="border-radius:{radius};">'
                f'<a href="{esc(url)}" target="_blank" style="display:inline-block;padding:14px 32px;font-family:{font};'
                f'font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:{radius};">{esc(label)}</a>'
                f'</td></tr></table>')

    def p(text, size=16, color=ink, align="center", weight=400, pad="0 32px 16px"):
        return (f'<tr><td style="padding:{pad};font-family:{font};font-size:{size}px;line-height:1.5;'
                f'color:{color};text-align:{align};font-weight:{weight};">{text}</td></tr>')

    out = []
    for b in spec["blocks"]:
        t = b["type"]
        if t == "announcement_bar":
            out.append(f'<tr><td bgcolor="{dark}" style="padding:10px 16px;font-family:{font};font-size:13px;'
                       f'letter-spacing:0.08em;text-transform:uppercase;color:#ffffff;text-align:center;font-weight:700;">'
                       f'{esc(b["text"])}</td></tr>')
        elif t == "header_logo":
            out.append(f'<tr><td style="padding:24px 16px 16px;text-align:center;"><a href="{esc(k["site"])}" target="_blank">'
                       f'<img src="{esc(k["logo"])}" width="160" alt="{esc(k["name"])}" style="display:inline-block;width:160px;'
                       f'max-width:60%;height:auto;border:0;"></a></td></tr>')
        elif t == "hero_product":  # product cut-out on a brand-colour panel, text as HTML
            out.append(f'<tr><td bgcolor="{b.get("panel", "#F6E7EF")}" style="padding:32px 24px 8px;text-align:center;">'
                       f'<div style="font-family:{font};font-size:13px;letter-spacing:0.12em;text-transform:uppercase;color:{accent};font-weight:700;padding-bottom:8px;">{esc(b.get("eyebrow",""))}</div>'
                       f'<div style="font-family:{font};font-size:32px;line-height:1.15;color:{ink};font-weight:700;padding-bottom:12px;">{esc(b["headline"])}</div>'
                       f'<div style="font-family:{font};font-size:16px;line-height:1.5;color:{ink};padding-bottom:20px;">{esc(b.get("sub",""))}</div>'
                       f'<a href="{esc(b["url"])}" target="_blank"><img src="{esc(b["image"])}" width="420" alt="{esc(b.get("alt",""))}" '
                       f'style="display:block;margin:0 auto;width:420px;max-width:100%;height:auto;border:0;border-radius:{radius};"></a>'
                       f'</td></tr>')
            out.append(f'<tr><td bgcolor="{b.get("panel", "#F6E7EF")}" style="padding:20px 24px 32px;">{btn(b["cta"], b["url"])}</td></tr>')
        elif t == "text":
            if b.get("heading"):
                out.append(p(f"<strong>{esc(b['heading'])}</strong>", size=22, pad="28px 32px 8px"))
            for para in b["paras"]:
                out.append(p(esc(para), align=b.get("align", "center")))
        elif t == "steps":  # numbered how-to / benefit list
            if b.get("heading"):
                out.append(p(f"<strong>{esc(b['heading'])}</strong>", size=22, pad="28px 32px 12px"))
            rows = "".join(
                f'<tr><td width="40" valign="top" style="padding:0 12px 14px 0;"><div style="width:32px;height:32px;line-height:32px;'
                f'border-radius:16px;background:{accent};color:#fff;font-family:{font};font-weight:700;text-align:center;">{i+1}</div></td>'
                f'<td valign="top" style="padding:4px 0 14px;font-family:{font};font-size:16px;line-height:1.5;color:{ink};">'
                f'<strong>{esc(s[0])}</strong> {esc(s[1])}</td></tr>' for i, s in enumerate(b["items"]))
            out.append(f'<tr><td style="padding:0 40px 8px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">{rows}</table></td></tr>')
        elif t == "product_grid_2col":
            if b.get("heading"):
                out.append(p(f"<strong>{esc(b['heading'])}</strong>", size=22, pad="28px 32px 12px"))
            cells = []
            for pr in b["products"]:
                cells.append(
                    f'<td class="col" width="50%" valign="top" style="padding:8px;text-align:center;">'
                    f'<a href="{esc(pr["url"])}" target="_blank"><img src="{esc(pr["image"])}" width="260" alt="{esc(pr["title"])}" '
                    f'style="display:block;width:100%;max-width:260px;height:auto;margin:0 auto;border:0;border-radius:{radius};"></a>'
                    f'<div style="font-family:{font};font-size:15px;font-weight:700;color:{ink};padding:10px 4px 4px;">{esc(pr["title"])}</div>'
                    f'<div style="font-family:{font};font-size:14px;color:{ink};padding-bottom:10px;">{esc(pr["price"])}</div>'
                    f'<a href="{esc(pr["url"])}" target="_blank" style="font-family:{font};font-size:14px;font-weight:700;color:{accent};">Shop now &rarr;</a></td>')
            rows = "".join("<tr>" + "".join(cells[i:i+2]) + "</tr>" for i in range(0, len(cells), 2))
            out.append(f'<tr><td style="padding:0 16px 16px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">{rows}</table></td></tr>')
        elif t == "faq":
            out.append(p(f"<strong>{esc(b.get('heading','Questions'))}</strong>", size=22, pad="28px 32px 12px"))
            for q, a in b["items"]:
                out.append(f'<tr><td style="padding:0 40px 14px;font-family:{font};font-size:16px;line-height:1.5;color:{ink};text-align:left;">'
                           f'<strong>{esc(q)}</strong><br>{esc(a)}</td></tr>')
        elif t == "cta":
            out.append(f'<tr><td style="padding:16px 24px 32px;">{btn(b["label"], b["url"])}</td></tr>')
        elif t == "signoff":
            out.append(p(esc(b["text"]), align="center", pad="8px 32px 32px"))
        elif t == "footer":  # Klaviyo-required tags baked in (VISION section 10)
            out.append(f'<tr><td bgcolor="#F3F3F3" style="padding:24px 24px 32px;font-family:{font};font-size:12px;line-height:1.6;color:#555555;text-align:center;">'
                       f'{{{{ organization.name }}}}<br>{{{{ organization.full_address }}}}<br><br>'
                       f'No longer want these emails? {{% unsubscribe "Unsubscribe" %}} &middot; {{% manage_preferences "Preferences" %}}<br>'
                       f'Trouble viewing? {{% web_view "View in browser" %}}</td></tr>')
        else:
            raise ValueError(f"unknown block {t}")

    preheader = esc(spec.get("preview", ""))
    return f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting"><title>{esc(spec['subject'])}</title>
<style>@media only screen and (max-width:620px){{.container{{width:100%!important}} .col{{display:block!important;width:100%!important}}}}</style></head>
<body style="margin:0;padding:0;background:{bg};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">{preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="{bg}"><tr><td align="center" style="padding:0;">
<table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="width:600px;max-width:600px;">
{''.join(out)}
</table></td></tr></table></body></html>"""

if __name__ == "__main__":
    spec = json.load(open(sys.argv[1]))
    html_out = render(spec)
    open(sys.argv[2], "w").write(html_out)
    print(sys.argv[2], len(html_out.encode()), "bytes")

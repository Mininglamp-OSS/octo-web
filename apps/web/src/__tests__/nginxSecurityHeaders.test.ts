import * as fs from 'fs';
import * as path from 'path';

describe('Nginx Security Headers', () => {
  let nginxConfig: string;

  beforeAll(() => {
    const configPath = path.resolve(__dirname, '../../../../nginx.conf.template');
    nginxConfig = fs.readFileSync(configPath, 'utf-8');
  });

  it('should contain X-Frame-Options header to prevent clickjacking', () => {
    expect(nginxConfig).toContain('X-Frame-Options');
    expect(nginxConfig).toMatch(/add_header\s+X-Frame-Options\s+"SAMEORIGIN"/);
  });

  it('should contain X-Content-Type-Options header to prevent MIME sniffing', () => {
    expect(nginxConfig).toContain('X-Content-Type-Options');
    expect(nginxConfig).toMatch(/add_header\s+X-Content-Type-Options\s+"nosniff"/);
  });

  it('should contain X-XSS-Protection header for legacy browser protection', () => {
    expect(nginxConfig).toContain('X-XSS-Protection');
    expect(nginxConfig).toMatch(/add_header\s+X-XSS-Protection\s+"1;\s*mode=block"/);
  });

  it('should contain Referrer-Policy header', () => {
    expect(nginxConfig).toContain('Referrer-Policy');
    expect(nginxConfig).toMatch(/add_header\s+Referrer-Policy\s+"strict-origin-when-cross-origin"/);
  });

  it('should contain Content-Security-Policy header', () => {
    expect(nginxConfig).toContain('Content-Security-Policy');
    expect(nginxConfig).toMatch(/add_header\s+Content-Security-Policy\s+"/);
  });

  it('should have CSP with safe defaults', () => {
    expect(nginxConfig).toMatch(/default-src\s+'self'/);
    expect(nginxConfig).toMatch(/object-src\s+'none'/);
    expect(nginxConfig).toMatch(/frame-ancestors\s+'self'/);
  });

  it('should have worker-src directive to allow blob Workers (AMR voice decoding)', () => {
    expect(nginxConfig).toMatch(/worker-src\s+'self'\s+blob:/);
  });

  it('should have media-src directive allowing HTTPS CDN for video/audio preview', () => {
    expect(nginxConfig).toMatch(/media-src\s+'self'\s+blob:\s+https:/);
  });

  it('should not carry an inert frame-src source', () => {
    // A previous revision added `frame-src 'self' https://__bridge_loaded__`
    // believing it unblocked the native WebViewJavascriptBridge bootstrap
    // iframe. It does not: underscore is not a valid CSP host-char, so the
    // source is discarded and the directive collapses to `frame-src 'self'` —
    // byte-for-byte the same restriction the default-src fallback already gave.
    // Guard against re-adding it.
    const csp = nginxConfig.match(/Content-Security-Policy "([^"]*)"/);
    expect(csp).not.toBeNull();
    expect(csp[1]).not.toContain('__bridge_loaded__');
    // And never widen frame-src to a blanket scheme source.
    const frameSrc = csp[1].match(/frame-src ([^;]*);/);
    if (frameSrc) {
      expect(frameSrc[1]).not.toMatch(/(^|\s)https:(\s|$)/);
    }
  });

  it('should have HSTS header available (commented for manual enable)', () => {
    expect(nginxConfig).toContain('Strict-Transport-Security');
  });
});

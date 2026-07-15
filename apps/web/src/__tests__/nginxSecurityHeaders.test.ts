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

  it('should have HSTS header available (commented for manual enable)', () => {
    expect(nginxConfig).toContain('Strict-Transport-Security');
  });
});

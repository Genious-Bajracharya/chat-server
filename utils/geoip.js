// Get country from IP address using free API
async function getCountryFromIP(ip) {
  try {
    if (!ip || ip === '::1' || ip === '127.0.0.1' || ip.startsWith('192.168')) {
      return 'Local/Private';
    }

    const response = await fetch(`https://ipapi.co/${ip}/json/`);
    if (!response.ok) throw new Error('Failed to fetch IP info');

    const data = await response.json();
    return data.country_name || 'Unknown';
  } catch (err) {
    console.error('Geolocation error:', err.message);
    return 'Unknown';
  }
}

// Parse user agent to extract device info
function parseDeviceInfo(userAgent) {
  if (!userAgent) return 'Unknown';

  const ua = userAgent.toLowerCase();
  let browser = 'Unknown';
  let os = 'Unknown';
  let device = 'Desktop';

  // Detect browser
  if (ua.includes('edg/')) browser = 'Edge';
  else if (ua.includes('chrome')) browser = 'Chrome';
  else if (ua.includes('safari') && !ua.includes('chrome')) browser = 'Safari';
  else if (ua.includes('firefox')) browser = 'Firefox';
  else if (ua.includes('opera')) browser = 'Opera';

  // Detect OS
  if (ua.includes('windows')) os = 'Windows';
  else if (ua.includes('mac')) os = 'macOS';
  else if (ua.includes('linux')) os = 'Linux';
  else if (ua.includes('iphone') || ua.includes('ipad')) os = 'iOS';
  else if (ua.includes('android')) os = 'Android';

  // Detect device type
  if (ua.includes('mobile') || ua.includes('android') || ua.includes('iphone')) {
    device = 'Mobile';
  } else if (ua.includes('tablet') || ua.includes('ipad')) {
    device = 'Tablet';
  }

  return `${browser} on ${os} (${device})`;
}

module.exports = { getCountryFromIP, parseDeviceInfo };

import { createFileRoute } from '@tanstack/react-router'
import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { invoke } from '@tauri-apps/api/core'
import logo from '@/assets/logo.svg'
import { openUrl } from "@tauri-apps/plugin-opener"
import { fetch } from '@tauri-apps/plugin-http';
import { DeviceInfo } from '@/types'

export const Route = createFileRoute('/login')({
  component: RouteComponent,
})

interface CodeDigitProps {
  char: string;
  isLoading?: boolean;
}

const CodeDigit = ({ char, isLoading }: CodeDigitProps) => (
  <span
    className={`inline-flex w-8 h-10 items-center justify-center border-2 border-muted rounded-lg font-mono text-xl ${
      isLoading ? "bg-muted animate-pulse" : ""
    }`}
  >
    {!isLoading && char}
  </span>
);

const CodeDisplay = ({ code, isLoading = false }: { code?: string; isLoading?: boolean }) => {
  const displayCode = code || "000000";
  return (
    <div className="inline-flex items-center gap-2">
      <span className="inline-flex gap-2">
        {displayCode.slice(0, 3).split("").map((char, i) => (
          <CodeDigit key={i} char={char} isLoading={isLoading} />
        ))}
      </span>
      <span className="inline-block px-1 font-mono">—</span>
      <span className="inline-flex gap-2">
        {displayCode.slice(3).split("").map((char, i) => (
          <CodeDigit key={i} char={char} isLoading={isLoading} />
        ))}
      </span>
    </div>
  );
};

function RouteComponent() {
  const [enrollmentCode, setEnrollmentCode] = useState<string | null>(null);
  const [deviceInfo, setDeviceInfo] = useState<DeviceInfo | null>(null);
  const [isLoadingCode, setIsLoadingCode] = useState(true);
  const [isEnrolled, setIsEnrolled] = useState(false);
  const [organizationName, setOrganizationName] = useState<string | null>(null);

  const generateRandomCode = () => {
    const code = Math.floor(Math.random() * 900000) + 100000; // Generate 6-digit number
    return code.toString();
  };

  const fetchEnrollmentCode = async (deviceInfo: DeviceInfo) => {
    setIsLoadingCode(true);
    try {
      const response = await fetch('http://localhost:8000/api/sync/get_code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hostname: deviceInfo.hostname,
          platform: deviceInfo.platform,
          release: deviceInfo.release,
          arch: deviceInfo.arch,
          cpus: deviceInfo.cpus,
          total_memory: deviceInfo.total_memory,
          os_type: deviceInfo.os_type,
          device_id: deviceInfo.device_id,
          device_fingerprint: deviceInfo.device_fingerprint
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      
      if (data.success && data.otp_code) {
        setEnrollmentCode(data.otp_code);
        console.log('Retrieved enrollment code for device:', deviceInfo);
        console.log('Code expires at:', data.expires_at);
      } else {
        throw new Error('Invalid response format or unsuccessful request');
      }
    } catch (error) {
      console.error('Failed to fetch enrollment code:', error);
      toast.error('Failed to fetch enrollment code from server');
      // Fallback to random code
      setEnrollmentCode(generateRandomCode());
    } finally {
      setIsLoadingCode(false);
    }
  };

  const pollEnrollment = async (deviceInfo: DeviceInfo) => {
    try {
      const response = await fetch('http://localhost:8000/api/sync/poll_enrollment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          device_fingerprint: deviceInfo.device_fingerprint
        })
      });

      if (!response.ok) {
        console.error('Failed to poll enrollment status:', response.status);
        return;
      }

      const data = await response.json();
      console.log('Poll response:', data);
      
      if (data.success && data.enrolled) {
        setIsEnrolled(true);
        setOrganizationName(data.organization_name || 'Unknown Organization');
        console.log('Device enrolled:', data);
      }
    } catch (error) {
      console.error('Error polling enrollment status:', error);
    }
  };

  const handleOpenEnrollPage = async () => {
    try {
        await openUrl("https://labric.co/enroll");
      // For now, just show a toast since we don't have the Tauri API setup
      toast.info('Would open labric.co/enroll');
    } catch (err) {
      console.error('Failed to open enrollment page:', err);
      toast.error('Failed to open enrollment page');
    }
  };

  useEffect(() => {
    // Gather device information
    const getDeviceInfo = async () => {
      try {
        const info = (await invoke("get_device_info")) as DeviceInfo;
        setDeviceInfo(info);
        // Generate initial code with device info
        await fetchEnrollmentCode(info);
      } catch (error) {
        console.error("Failed to get device info:", error);
        toast.error('Failed to get device information');
        // Fallback device info
        const fallbackInfo: DeviceInfo = {
          hostname: "Unknown",
          platform: "Unknown",
          release: "Unknown",
          arch: "Unknown",
          cpus: 0,
          total_memory: 0,
          os_type: "Unknown",
          device_id: "Unknown",
          device_fingerprint: "Unknown",
        };
        setDeviceInfo(fallbackInfo);
        await fetchEnrollmentCode(fallbackInfo);
      }
    };

    getDeviceInfo();
  }, []);

  useEffect(() => {
    // Set up interval to generate new code every 30 seconds
    if (!deviceInfo || isEnrolled) return;

    const interval = setInterval(async () => {
      await fetchEnrollmentCode(deviceInfo);
      toast.success('New enrollment code generated');
    }, 30000);

    return () => clearInterval(interval);
  }, [deviceInfo, isEnrolled]);

  useEffect(() => {
    // Set up polling for enrollment status every second
    if (!deviceInfo || isEnrolled) return;

    const interval = setInterval(async () => {
      await pollEnrollment(deviceInfo);
    }, 1000);

    return () => clearInterval(interval);
  }, [deviceInfo, isEnrolled]);

  return (
    <div className="flex flex-col items-center justify-center h-svh p-6 gap-6">
      <div className="flex items-center justify-center gap-3">
        <img src={logo} alt="Labric Sync" className="w-10 h-10" />
        <h1 className="text-2xl font-semibold">Labric Sync</h1>
      </div>
      <div className="w-full max-w-sm flex flex-col items-center justify-center gap-4">
        {isEnrolled ? (
          <div className="text-center">
            <h2 className="text-xl font-semibold text-green-600 mb-2">Device Enrolled!</h2>
            <p className="text-lg">{organizationName}</p>
          </div>
        ) : (
          <CodeDisplay code={enrollmentCode || undefined} isLoading={isLoadingCode} />
        )}
      </div>
      {!isEnrolled && (
        <h2 className="text-md text-muted-foreground mb-4">
          Enter this code at{" "}
          <button
            onClick={handleOpenEnrollPage}
            className="text-blue-400 hover:underline cursor-pointer bg-transparent border-none p-0 font-inherit"
          >
            labric.co/enroll
          </button>
        </h2>
      )}
    </div>
  );
}

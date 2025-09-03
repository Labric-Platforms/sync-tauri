import { useState, useEffect, useRef } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { invoke } from '@tauri-apps/api/core'
import { openUrl } from "@tauri-apps/plugin-opener"
import { fetch } from '@tauri-apps/plugin-http';
import { toast } from 'sonner'
import { DeviceInfo } from '@/types'
import logo from '@/assets/logo.svg'
import { getToken, setToken, getOrganizationId, setOrganizationId } from '@/lib/store'

export const Route = createFileRoute('/login')({
  component: Login,
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

function Login() {
  const [enrollmentCode, setEnrollmentCode] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const isSigningInRef = useRef(false);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const navigate = useNavigate();

  // Check if already signed in and redirect
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const token = await getToken();
        if (token && token.exp && token.exp > Date.now() / 1000) {
          navigate({ to: '/dashboard' });
          return;
        }
      } catch (error) {
        console.error('Error checking auth:', error);
      }
      
      // If not signed in, start enrollment process
      await initializeEnrollment();
    };
    checkAuth();
  }, [navigate]);

  // Cleanup interval on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, []);

  const apiCall = async (endpoint: string, body: any, token?: string) => {
    return fetch(`${import.meta.env.VITE_SERVER_URL}/api/sync/${endpoint}`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        ...(token && { 'Authorization': `Bearer ${token}` })
      },
      body: JSON.stringify(body)
    });
  };

  const initializeEnrollment = async () => {
    try {
      // Get device info
      const info = (await invoke("get_device_info")) as DeviceInfo;
      
      // Get enrollment code
      await fetchEnrollmentCode(info);
      
      // Start polling for enrollment
      startPolling(info);
      
    } catch (error) {
      console.error('Failed to initialize enrollment:', error);
      toast.error('Failed to initialize enrollment');
    }
  };

  const fetchEnrollmentCode = async (deviceInfo: DeviceInfo) => {
    try {
      const requestBody: any = {
        hostname: deviceInfo.hostname,
        platform: deviceInfo.platform,
        release: deviceInfo.release,
        arch: deviceInfo.arch,
        cpus: deviceInfo.cpus,
        total_memory: deviceInfo.total_memory,
        os_type: deviceInfo.os_type,
        device_id: deviceInfo.device_id,
        device_fingerprint: deviceInfo.device_fingerprint
      };
      
      // Include org ID if available
      try {
        const organizationId = await getOrganizationId();
        if (organizationId) {
          requestBody.org_id = organizationId;
        }
      } catch (error) {
        // Ignore error, org ID is optional
      }

      const response = await apiCall('get_code', requestBody);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      
      if (data.success && data.otp_code) {
        setEnrollmentCode(data.otp_code);
      } else {
        throw new Error('Invalid response format');
      }
    } catch (error) {
      console.error('Failed to fetch enrollment code:', error);
      toast.error('Failed to fetch enrollment code');
    } finally {
      setIsLoading(false);
    }
  };

  const startPolling = (deviceInfo: DeviceInfo) => {
    // Clear any existing interval
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
    }

    pollIntervalRef.current = setInterval(async () => {
      try {
        const response = await apiCall('poll_enrollment', {
          device_fingerprint: deviceInfo.device_fingerprint
        });

        if (!response.ok) return;

        const data = await response.json();
        
        if (data.success && data.enrolled && data.signin_token && !isSigningInRef.current) {
          // Immediately set the flag to prevent duplicate calls
          isSigningInRef.current = true;
          
          // Clear the interval
          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
          }
          
          // Sign in with promise toast
          const signInPromise = signIn(data.signin_token, data.organization_id);
          toast.promise(signInPromise, {
            loading: 'Pairing to your organization...',
            success: 'Successfully paired device',
            error: 'Failed to pair device'
          });
        }
      } catch (error) {
        console.error('Error polling enrollment:', error);
      }
    }, 1000);
  };

  const signIn = async (token: string, organizationId?: string) => {
    await setToken(token);
    
    if (organizationId) {
      await setOrganizationId(organizationId);
    }
    
    navigate({ to: '/dashboard' });
  };

  const handleOpenEnrollPage = async () => {
    try {
      await openUrl("https://platform.labric.co/enroll");
    } catch (error) {
      console.error('Failed to open enrollment page:', error);
      toast.error('Failed to open enrollment page');
    }
  };

  return (
    <div className="flex flex-col items-center justify-center h-svh p-6 gap-6">
      <div className="flex items-center justify-center gap-1.5">
        <img src={logo} alt="Labric Sync" className="w-10 h-10" />
        <h1 className="text-2xl font-semibold">Labric Sync</h1>
      </div>
      
      <div className="w-full max-w-sm flex flex-col items-center justify-center gap-4">
        <CodeDisplay code={enrollmentCode || undefined} isLoading={isLoading} />
      </div>
      
      <h2 className="text-md text-muted-foreground mb-4">
        Enter this code at{" "}
        <button
          onClick={handleOpenEnrollPage}
          className="text-blue-400 hover:underline cursor-pointer bg-transparent border-none p-0 font-inherit"
        >
          labric.co/enroll
        </button>
      </h2>
    </div>
  );
}
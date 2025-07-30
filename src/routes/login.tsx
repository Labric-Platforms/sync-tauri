import { useState, useEffect } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useNavigate } from '@tanstack/react-router'
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

const EnrolledDisplay = () => {
  const [orgName, setOrgName] = useState<string>('Unknown Organization');

  useEffect(() => {
    const loadOrgName = async () => {
      try {
        const token = await getToken();
        if (token?.org_name) {
          setOrgName(token.org_name);
        }
      } catch (error) {
        console.error('Error loading organization name:', error);
      }
    };
    loadOrgName();
  }, []);

  return (
    <div className="text-center">
      <h2 className="text-xl font-semibold text-green-600 mb-2">Device Enrolled!</h2>
      <p className="text-lg">{orgName}</p>
    </div>
  );
};

function Login() {
  const [enrollmentCode, setEnrollmentCode] = useState<string | null>(null);
  const [isLoadingCode, setIsLoadingCode] = useState(true);
  const [deviceInfo, setDeviceInfo] = useState<DeviceInfo | null>(null);
  const [isEnrolled, setIsEnrolled] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);

  const navigate = useNavigate();

  const apiCall = (endpoint: string, body: any, token?: string) => 
    fetch(`${import.meta.env.VITE_SERVER_URL}/api/sync/${endpoint}`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        ...(token && { 'Authorization': `Bearer ${token}` })
      },
      body: JSON.stringify(body)
    });

  const handleError = (error: any, message: string, toastId: string) => {
    console.error(message, error);
    toast.error(message, { id: toastId });
  };

  useEffect(() => {
    const checkAuth = async () => {
      const token = await getToken();
      if (token) {
        navigate({ to: '/' });
      }
    };
    checkAuth();
  }, [navigate]);

  const fetchEnrollmentCode = async (deviceInfo: DeviceInfo) => {
    setIsLoadingCode(true);
    try {
      // Check if org ID is in the store
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
      
      try {
        const organizationId = await getOrganizationId();
        if (organizationId) {
          requestBody.org_id = organizationId;
          console.log('Found organization ID in store:', organizationId);
        }
      } catch (error) {
        console.log('Error retrieving organization ID:', error);
      }

      const response = await apiCall('get_code', requestBody);

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
      handleError(error, 'Failed to fetch enrollment code from server', 'enrollment-code-error');
    } finally {
      setIsLoadingCode(false);
    }
  };

  const pollEnrollment = async (deviceInfo: DeviceInfo) => {
    try {
      const response = await apiCall('poll_enrollment', {
        device_fingerprint: deviceInfo.device_fingerprint
      });

      if (!response.ok) {
        console.error('Failed to poll enrollment status:', response.status);
        return;
      }

      const data = await response.json();
      console.log('Poll response:', data);
      
      if (data.success && data.enrolled) {
        setIsEnrolled(true);
        console.log('Device enrolled:', data);
        
        // Handle token-based authentication
        if (data.signin_token && !isSigningIn) {
          setIsSigningIn(true);
          toast.info('Signing you in...', { id: 'signing-in' });
          
          try {
            // Store the token and organization ID
            await setToken(data.signin_token);
            
            if (data.organization_id) {
              await setOrganizationId(data.organization_id);
              console.log('Successfully stored organization info');
            }
            
            // Call finish_enrollment API with device fingerprint
            try {
              console.log("Calling finish_enrollment", data.signin_token);
              const finishResponse = await apiCall('finish_enrollment', {
                device_fingerprint: deviceInfo.device_fingerprint
              }, data.signin_token);

              if (!finishResponse.ok) {
                console.warn('Failed to complete enrollment finalization:', finishResponse.status);
              }
            } catch (finishError) {
              console.warn('Error calling finish_enrollment:', finishError);
            }
            
            toast.success('Successfully signed in!', { id: 'sign-in-success' });
            
            // Navigate to dashboard
            navigate({ to: '/dashboard' });
            
          } catch (error) {
            handleError(error, 'Failed to sign in with token', 'sign-in-error');
            setIsSigningIn(false);
          }
        }
      }
    } catch (error) {
      console.error('Error polling enrollment status:', error);
    }
  };

  const handleOpenEnrollPage = async () => {
    try {
        await openUrl("https://platform.labric.co/enroll");
    } catch (err) {
      handleError(err, 'Failed to open enrollment page', 'enrollment-page-error');
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
        handleError(error, 'Failed to get device information', 'device-info-error');
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
    // Set up interval to generate new code every 120 seconds
    if (!deviceInfo || isEnrolled) return;

    const interval = setInterval(async () => {
      await fetchEnrollmentCode(deviceInfo);
      toast.success('New enrollment code generated', { id: 'enrollment-code-generated' });
    }, 120000);

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
        {isSigningIn ? (
          <div className="text-center">
            <h2 className="text-xl font-semibold text-blue-600 mb-2">Signing you in...</h2>
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
          </div>
        ) : isEnrolled ? (
          <EnrolledDisplay />
        ) : (
          <CodeDisplay code={enrollmentCode || undefined} isLoading={isLoadingCode} />
        )}
      </div>
      {!isEnrolled && !isSigningIn && (
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

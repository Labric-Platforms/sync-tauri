import { useState, useEffect } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useNavigate } from '@tanstack/react-router'
import { invoke } from '@tauri-apps/api/core'
import { openUrl } from "@tauri-apps/plugin-opener"
import { fetch } from '@tauri-apps/plugin-http';
import { useSignIn, useUser, useClerk } from '@clerk/clerk-react'
import { Store } from '@tauri-apps/plugin-store'
import { toast } from 'sonner'
import { DeviceInfo } from '@/types'
import logo from '@/assets/logo.svg'

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
  const [isSigningIn, setIsSigningIn] = useState(false);
  
  // Clerk hooks for authentication
  const { signIn, setActive } = useSignIn();
  const { user } = useUser();
  const clerk = useClerk();
  const navigate = useNavigate();

  // If user is already signed in, redirect to home
  useEffect(() => {
    if (user) {
      navigate({ to: '/' });
    }
  }, [user, navigate]);

  const generateRandomCode = () => {
    const code = Math.floor(Math.random() * 900000) + 100000; // Generate 6-digit number
    return code.toString();
  };

  const fetchEnrollmentCode = async (deviceInfo: DeviceInfo) => {
    setIsLoadingCode(true);
    try {
      // Check if org ID is in the store
      let organizationId: string | null = null;
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
        const store = await Store.load('app-store.json');
        const storedOrgId = await store.get('organization_id');
        console.log('Retrieved from store - org ID:', storedOrgId, 'Type:', typeof storedOrgId, 'Truthy:', !!storedOrgId);
        
        if (storedOrgId && typeof storedOrgId === 'string') {
          organizationId = storedOrgId;
          requestBody.org_id = organizationId;
          console.log('Found valid organization ID in store:', organizationId);
        } else {
          console.log('Organization ID in store is null/undefined or invalid type:', storedOrgId);
          // Let's also check if it exists but is a different type
          if (storedOrgId !== null && storedOrgId !== undefined) {
            console.log('Attempting to convert to string:', String(storedOrgId));
            organizationId = String(storedOrgId);
            requestBody.org_id = organizationId;
          }
        }
      } catch (error) {
        console.log('No organization ID found in store or store not accessible:', error);
      }

      const response = await fetch(`${import.meta.env.VITE_SERVER_URL}/api/sync/get_code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
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
      toast.error('Failed to fetch enrollment code from server', {id: 'enrollment-code-error'});
      // Fallback to random code
      setEnrollmentCode(generateRandomCode());
    } finally {
      setIsLoadingCode(false);
    }
  };

  const pollEnrollment = async (deviceInfo: DeviceInfo) => {
    try {
      const response = await fetch(`${import.meta.env.VITE_SERVER_URL}/api/sync/poll_enrollment`, {
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
        
        
        console.log('Signin token:', data.signin_token);
        console.log("signin", signIn)
        console.log("setActive", setActive)
        console.log("isSigningIn", isSigningIn)
        
        // Check if we received a sign-in token and Clerk is properly loaded
        if (data.signin_token && !isSigningIn && signIn && setActive) {
          setIsSigningIn(true);
          toast.info('Signing you in...', { id: 'signing-in' });
          
          try {
            // Create the SignIn with the token using Clerk
            const signInAttempt = await signIn.create({
              strategy: 'ticket',
              ticket: data.signin_token,
            });

            // If the sign-in was successful, set the session to active
            if (signInAttempt.status === 'complete') {
              await setActive({
                session: signInAttempt.createdSessionId,
              });
              
              // Get user organization info from Clerk session
              try {
                const token = await clerk.session?.getToken();
                const user = clerk.user;
                console.log('Clerk user after sign-in:', user);
                
                // Store organization info in Tauri store
                if (user?.organizationMemberships && user.organizationMemberships.length > 0) {
                  const orgMembership = user.organizationMemberships[0];
                  const orgId = orgMembership.organization.id;
                  const orgName = orgMembership.organization.name;
                  
                  console.log('Found organization from Clerk:', { orgId, orgName });
                  
                  try {
                    const store = await Store.load('app-store.json');
                    await store.set('organization_id', orgId);
                    await store.set('organization_name', orgName);
                    await store.save();
                    
                    console.log('Successfully stored organization info:', { orgId, orgName });
                  } catch (storeError) {
                    console.error('Failed to store organization info:', storeError);
                  }
                } else {
                  console.warn('No organization memberships found for user');
                }
              } catch (orgError) {
                console.error('Error retrieving organization info:', orgError);
              }
              
              // Call finish_enrollment API with device fingerprint
              try {
                // get the token
                const token = await clerk.session?.getToken();
                console.log("Calling finish_enrollment")
                const finishResponse = await fetch(`${import.meta.env.VITE_SERVER_URL}/api/sync/finish_enrollment`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                  body: JSON.stringify({
                    device_fingerprint: deviceInfo.device_fingerprint
                  })
                });
                console.log("finishResponse", finishResponse)

                if (!finishResponse.ok) {
                  console.warn('Failed to complete enrollment finalization:', finishResponse.status);
                }
              } catch (finishError) {
                console.warn('Error calling finish_enrollment:', finishError);
              }
              
              toast.success('Successfully signed in!', { id: 'sign-in-success' });
              // Navigation will happen via the useEffect above when user state updates
            } else {
              console.error('Sign-in attempt not complete:', signInAttempt);
              toast.error('Sign-in incomplete. Please try again.', { id: 'sign-in-incomplete' });
              setIsSigningIn(false);
            }
          } catch (error) {
            console.error('Error signing in with token:', error);
            toast.error('Failed to sign in with token', { id: 'sign-in-error' });
            setIsSigningIn(false);
          }
        } else if (data.signin_token && !signIn) {
          console.error('Clerk signIn not available - Clerk may not be properly initialized');
          toast.error('Authentication not ready. Please refresh the page.', { id: 'clerk-not-ready' });
        }
      }
    } catch (error) {
      console.error('Error polling enrollment status:', error);
    }
  };

  const handleOpenEnrollPage = async () => {
    try {
        await openUrl("https://platform.labric.co/enroll");
      // For now, just show a toast since we don't have the Tauri API setup
      toast.info('Would open labric.co/enroll', {id: 'enrollment-page-info'});
    } catch (err) {
      console.error('Failed to open enrollment page:', err);
      toast.error('Failed to open enrollment page', {id: 'enrollment-page-error'});
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
        toast.error('Failed to get device information', {id: 'device-info-error'});
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
    if (!deviceInfo || isEnrolled || !clerk.loaded) return;

    const interval = setInterval(async () => {
      await pollEnrollment(deviceInfo);
    }, 1000);

    return () => clearInterval(interval);
  }, [deviceInfo, isEnrolled, clerk.loaded]);

  // Show loading state while Clerk is initializing
  if (!clerk.loaded) {
    return (
      <div className="flex flex-col items-center justify-center h-svh p-6 gap-6">
        <div className="flex items-center justify-center gap-3">
          <img src={logo} alt="Labric Sync" className="w-10 h-10" />
          <h1 className="text-2xl font-semibold">Labric Sync</h1>
        </div>
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-2"></div>
          <p className="text-muted-foreground">Initializing...</p>
        </div>
      </div>
    );
  }

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
          <div className="text-center">
            <h2 className="text-xl font-semibold text-green-600 mb-2">Device Enrolled!</h2>
            <p className="text-lg">{organizationName}</p>
          </div>
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

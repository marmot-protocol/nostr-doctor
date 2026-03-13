import { Link, Outlet } from "react-router";
import doctorLogo from "../../assets/nostr-doctor.webp";
import Footer from "../../components/Footer.tsx";

function SignInLayout() {
  return (
    <div className="min-h-screen bg-base-100 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md flex-1 flex flex-col justify-center">
        {/* Wordmark */}
        <div className="mb-10 flex flex-col items-center gap-4 text-center">
          <Link to="/">
            <img
              src={doctorLogo}
              alt="Nostr Doctor logo"
              className="w-40 h-auto sm:w-44"
            />
          </Link>
          <Link to="/" className="hover:opacity-80 transition-opacity">
            <h2 className="text-3xl font-bold tracking-tight text-base-content">
              nostr.doctor
            </h2>
          </Link>
          <p className="text-sm text-base-content/50 max-w-xs">
            Diagnose and fix common Nostr issues
          </p>
        </div>

        <Outlet />
      </div>
      <Footer />
    </div>
  );
}

export default SignInLayout;

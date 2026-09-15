import { ProfileView } from "@/components/ProfileView";

interface ProfilePageProps {
  params: Promise<{ address: string }>;
}

export default async function ProfilePage({ params }: ProfilePageProps) {
  const { address } = await params;
  return <ProfileView address={address} />;
}
